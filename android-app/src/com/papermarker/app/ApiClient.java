package com.papermarker.app;

import android.content.Context;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;

/**
 * 服务端 HTTP 客户端（原生 HttpURLConnection 实现，无任何第三方依赖）
 * 与 Next.js 服务端 /api/* 直接通信：登录 / 任务 / 上传 / 打印 / 文件下载
 */
public class ApiClient {

    public interface ProgressListener {
        void onProgress(long sent, long total);
    }

    private static final Charset UTF8 = Charset.forName("UTF-8");
    private static final String BOUNDARY = "----PaperMarkerFormBoundary7MA4YWxk";

    /** 规范化服务器地址：补协议、去尾部斜杠 */
    public static String normalizeBase(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return "";
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    private static String url(Context ctx, String path) {
        return Prefs.getBase(ctx) + path;
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return new String(bos.toByteArray(), UTF8);
    }

    private static void checkResponse(HttpURLConnection conn, String body) throws Exception {
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) {
            String msg = body;
            try {
                JSONObject j = new JSONObject(body);
                msg = j.optString("msg", body);
            } catch (Exception ignored) {
            }
            if (msg == null || msg.isEmpty()) msg = "HTTP " + code;
            throw new Exception(msg);
        }
    }

    /** 登录：POST /api/auth/login → {code, token} */
    public static String login(Context ctx, String base, String username, String password) throws Exception {
        JSONObject body = new JSONObject();
        body.put("username", username);
        body.put("password", password);
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(base + "/api/auth/login").openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(15000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] data = body.toString().getBytes(UTF8);
            conn.setFixedLengthStreamingMode(data.length);
            OutputStream os = conn.getOutputStream();
            os.write(data);
            os.flush();
            os.close();
            String resp = readAll(conn.getInputStream());
            JSONObject r = new JSONObject(resp);
            if (r.optInt("code", 0) != 200 || !r.has("token")) {
                throw new Exception(r.optString("msg", "登录失败"));
            }
            return r.getString("token");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** 统一鉴权：优先 API Key（应用连接），否则 Bearer Token */
    private static void applyAuth(Context ctx, HttpURLConnection conn) {
        String key = Prefs.getApiKey(ctx);
        if (key != null && !key.isEmpty()) {
            conn.setRequestProperty("X-API-Key", key);
            return;
        }
        String token = Prefs.getToken(ctx);
        if (token != null && !token.isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + token);
        }
    }

    /** 附带鉴权的文件访问查询串（图片/PDF 下载等无法带 Header 的场景） */
    public static String authQuery(Context ctx, String path) {
        String key = Prefs.getApiKey(ctx);
        if (key != null && !key.isEmpty()) {
            return path + (path.contains("?") ? "&" : "?") + "apiKey=" + key;
        }
        String token = Prefs.getToken(ctx);
        if (token != null && !token.isEmpty()) {
            return path + (path.contains("?") ? "&" : "?") + "token=" + token;
        }
        return path;
    }

    /** GET JSON（自动附带鉴权） */
    public static JSONObject get(Context ctx, String path) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url(ctx, path)).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(30000);
            applyAuth(ctx, conn);
            String resp;
            try {
                resp = readAll(conn.getInputStream());
            } catch (IOException e) {
                resp = conn.getErrorStream() != null ? readAll(conn.getErrorStream()) : "";
            }
            checkResponse(conn, resp);
            return new JSONObject(resp);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** POST JSON（自动附带鉴权），非 2xx 时抛服务端 msg */
    public static JSONObject post(Context ctx, String path, JSONObject body) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url(ctx, path)).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(60000);
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            applyAuth(ctx, conn);
            byte[] data = body.toString().getBytes(UTF8);
            conn.setFixedLengthStreamingMode(data.length);
            OutputStream os = conn.getOutputStream();
            os.write(data);
            os.flush();
            os.close();
            String resp;
            try {
                resp = readAll(conn.getInputStream());
            } catch (IOException e) {
                resp = conn.getErrorStream() != null ? readAll(conn.getErrorStream()) : "";
            }
            // 打印等接口失败时返回 500 + msg，这里不抛异常，原样返回 JSON 由调用方分支处理
            return new JSONObject(resp);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /** 下载文件到本地（图片/PDF，token 走查询参数） */
    public static void download(Context ctx, String pathWithQuery, File dest) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url(ctx, pathWithQuery)).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(12000);
            conn.setReadTimeout(60000);
            int code = conn.getResponseCode();
            if (code != 200) throw new Exception("下载失败 HTTP " + code);
            InputStream in = new BufferedInputStream(conn.getInputStream(), 65536);
            FileOutputStream fos = new FileOutputStream(dest);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            fos.flush();
            fos.close();
            in.close();
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /**
     * 多页上传批改：POST /api/upload
     * multipart 字段 images（多文件） + paperName + studentName
     */
    public static JSONObject uploadPages(Context ctx, List<String> filePaths,
                                         String paperName, String studentName,
                                         ProgressListener listener) throws Exception {
        List<File> files = new ArrayList<>();
        for (String p : filePaths) files.add(new File(p));

        // 预计算 multipart 总长度（fixed length streaming mode）
        long total = 0;
        for (int i = 0; i < files.size(); i++) {
            total += fileHeader(i, files.get(i).getName()).length;
            total += files.get(i).length();
            total += 2; // \r\n
        }
        total += textPart("paperName", paperName).length;
        total += textPart("studentName", studentName).length;
        byte[] tail = ("--" + BOUNDARY + "--\r\n").getBytes(UTF8);
        total += tail.length;

        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url(ctx, "/api/upload")).openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(180000); // 服务端要做 VLM 批改 + PDF 生成
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + BOUNDARY);
            applyAuth(ctx, conn);
            conn.setFixedLengthStreamingMode(total);

            OutputStream raw = conn.getOutputStream();
            CountingOutputStream cos = new CountingOutputStream(raw, total, listener);
            DataOutputStream dos = new DataOutputStream(cos);

            for (int i = 0; i < files.size(); i++) {
                dos.write(fileHeader(i, files.get(i).getName()));
                FileInputStream fis = new FileInputStream(files.get(i));
                byte[] buf = new byte[65536];
                int n;
                while ((n = fis.read(buf)) > 0) dos.write(buf, 0, n);
                fis.close();
                dos.writeBytes("\r\n");
            }
            dos.write(textPart("paperName", paperName));
            dos.write(textPart("studentName", studentName));
            dos.write(tail);
            dos.flush();

            String resp;
            try {
                resp = readAll(conn.getInputStream());
            } catch (IOException e) {
                resp = conn.getErrorStream() != null ? readAll(conn.getErrorStream()) : "";
            }
            checkResponse(conn, resp);
            return new JSONObject(resp);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static byte[] fileHeader(int index, String filename) {
        String s = "--" + BOUNDARY + "\r\n"
                + "Content-Disposition: form-data; name=\"images\"; filename=\"" + filename + "\"\r\n"
                + "Content-Type: image/jpeg\r\n"
                + "\r\n";
        return s.getBytes(UTF8);
    }

    private static byte[] textPart(String name, String value) {
        String s = "--" + BOUNDARY + "\r\n"
                + "Content-Disposition: form-data; name=\"" + name + "\"\r\n"
                + "\r\n"
                + value + "\r\n";
        return s.getBytes(UTF8);
    }

    /** 统计已发送字节数的输出流，回调进度 */
    private static class CountingOutputStream extends OutputStream {
        private final OutputStream out;
        private final long total;
        private final ProgressListener listener;
        private long sent = 0;
        private long lastReport = 0;

        CountingOutputStream(OutputStream out, long total, ProgressListener listener) {
            this.out = out;
            this.total = total;
            this.listener = listener;
        }

        @Override
        public void write(int b) throws IOException {
            out.write(b);
            sent++;
            report();
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            out.write(b, off, len);
            sent += len;
            report();
        }

        private void report() {
            if (listener != null && sent - lastReport > 65536 * 4) {
                lastReport = sent;
                listener.onProgress(sent, total);
            }
        }

        @Override
        public void flush() throws IOException {
            out.flush();
        }

        @Override
        public void close() throws IOException {
            out.close();
        }
    }
}
