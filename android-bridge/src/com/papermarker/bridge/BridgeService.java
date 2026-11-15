package com.papermarker.bridge;

import android.app.*;
import android.content.*;
import android.os.*;
import android.util.Base64;
import android.util.Log;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/**
 * 前台服务：在 localhost:3790 运行 HTTP 服务器，桥接浏览器 → Brother TCP。
 *
 * v2.0.0 修复（v1.x 安卓完全无法打印/扫描的根因）：
 *  1. HTTP 解析 bug：旧版用 BufferedReader 读请求头（8KB 缓冲预读会把
 *     POST body 的前缀字节吞掉后丢弃），再切回裸 InputStream 读 body，
 *     导致 body 截断 → JSON 解析失败 → 请求永远到不了打印机。
 *     现在改用单一 BufferedInputStream 同时解析头部与 body。
 *  2. PNA（Private Network Access）：HTTPS 页面 → localhost 属 public → local
 *     请求，Chrome/WebView 要求预检与响应携带
 *     Access-Control-Allow-Private-Network: true，否则 fetch 被浏览器拦截。
 *
 * 接口：
 *  GET  /ping          健康检查
 *  POST /scan          Brother 扫描 → 返回 base64 JPEG 数组
 *  POST /print         Brother 直连打印（PWGRASTER 协议）
 *  POST /probe/scan    探测扫描仪
 *  POST /probe/print   探测打印机
 */
public class BridgeService extends Service {
    static final String TAG = "BridgeService";
    static final int PORT = 3790;
    static final int NOTIF_ID = 1;

    private ServerSocket server;
    private volatile boolean running = false;
    private ExecutorService pool = Executors.newCachedThreadPool();

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running) {
            running = true;
            new Thread(this::serve).start();
        }
        return START_STICKY;
    }

    void serve() {
        try {
            server = new ServerSocket(PORT, 50, InetAddress.getByName("127.0.0.1"));
            Log.i(TAG, "桥接服务监听 localhost:" + PORT);
            while (running) {
                Socket client = server.accept();
                pool.execute(() -> handle(client));
            }
        } catch (Exception e) {
            Log.e(TAG, "服务器异常: " + e.getMessage());
        }
    }

    /** 手工逐行读头部（从同一 BufferedInputStream 读，绝不预丢 body 字节） */
    static String readLine(BufferedInputStream in) throws IOException {
        StringBuilder sb = new StringBuilder(128);
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') break;
            if (b != '\r') sb.append((char) b);
            if (sb.length() > 16384) throw new IOException("请求行过长");
        }
        return sb.toString();
    }

    void handle(Socket client) {
        try {
            client.setTcpNoDelay(true);
            BufferedInputStream in = new BufferedInputStream(client.getInputStream(), 65536);

            String requestLine = readLine(in);
            if (requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String path = parts[1];

            int contentLength = 0;
            while (true) {
                String line = readLine(in);
                if (line.isEmpty()) break;
                int ci = line.toLowerCase().indexOf("content-length:");
                if (ci >= 0) {
                    try {
                        contentLength = Integer.parseInt(line.substring(ci + 15).trim());
                    } catch (NumberFormatException ignore) {}
                }
            }

            byte[] body = null;
            if (contentLength > 0) {
                if (contentLength > 64 * 1024 * 1024) {
                    sendResponse(client, 413, "{\"ok\":false,\"msg\":\"请求体过大\"}");
                    return;
                }
                body = new byte[contentLength];
                int off = 0;
                while (off < contentLength) {
                    int r = in.read(body, off, contentLength - off);
                    if (r < 0) break;
                    off += r;
                }
            }

            // CORS / PNA preflight
            if ("OPTIONS".equals(method)) {
                sendResponse(client, 200, "");
                return;
            }

            String json;
            int status = 200;
            try {
                json = handleRequest(method, path, body);
            } catch (Exception e) {
                status = 500;
                JSONObject err = new JSONObject();
                try {
                    err.put("ok", false);
                    err.put("msg", "处理异常：" + e.getMessage());
                } catch (Exception ignore) {}
                json = err.toString();
            }
            sendResponse(client, status, json);
        } catch (Exception e) {
            Log.e(TAG, "handle error: " + e.getMessage());
        } finally {
            try { client.close(); } catch (Exception e) {}
        }
    }

    String handleRequest(String method, String path, byte[] body) throws Exception {
        if ("/ping".equals(path) && "GET".equals(method)) {
            JSONObject r = new JSONObject();
            r.put("ok", true);
            r.put("service", "brother-bridge-android");
            r.put("version", "2.0.0");
            r.put("port", PORT);
            return r.toString();
        }

        JSONObject req = body != null && body.length > 0
                ? new JSONObject(new String(body, "UTF-8")) : new JSONObject();
        String host = req.optString("host", "").trim();
        JSONObject resp = new JSONObject();

        if (host.isEmpty()) {
            resp.put("ok", false);
            resp.put("msg", "缺少 host 参数");
            return resp.toString();
        }

        if ("/scan".equals(path) && "POST".equals(method)) {
            String colorMode = req.optString("colorMode", "CGRAY");
            int dpi = req.optInt("dpi", 300);
            String source = req.optString("source", "Platen");
            BrotherTcp.ScanResult r = BrotherTcp.scan(host, colorMode, dpi, source);
            resp.put("ok", r.ok);
            resp.put("msg", r.msg);
            resp.put("trace", new JSONArray(r.trace));
            JSONArray pages = new JSONArray();
            for (byte[] p : r.pages) {
                JSONObject pg = new JSONObject();
                pg.put("pageNo", pages.length());
                pg.put("base64", Base64.encodeToString(p, Base64.NO_WRAP));
                pg.put("size", p.length);
                pages.put(pg);
            }
            resp.put("pages", pages);
            return resp.toString();
        }

        if ("/print".equals(path) && "POST".equals(method)) {
            JSONArray jpegsArr = req.optJSONArray("jpegs");
            List<byte[]> jpegs = new ArrayList<>();
            if (jpegsArr != null) {
                for (int i = 0; i < jpegsArr.length(); i++) {
                    jpegs.add(Base64.decode(jpegsArr.getString(i), Base64.NO_WRAP));
                }
            }
            String jobName = req.optString("jobName", "PaperMarker");
            BrotherTcp.ScanResult r = BrotherTcp.print(host, jpegs, jobName);
            resp.put("ok", r.ok);
            resp.put("msg", r.msg);
            return resp.toString();
        }

        if ("/probe/scan".equals(path) && "POST".equals(method)) {
            BrotherTcp.ScanResult r = BrotherTcp.probeScanner(host);
            resp.put("ok", r.ok);
            resp.put("msg", r.msg);
            resp.put("trace", new JSONArray(r.trace));
            return resp.toString();
        }

        if ("/probe/print".equals(path) && "POST".equals(method)) {
            BrotherTcp.ScanResult r = BrotherTcp.probePrinter(host);
            resp.put("ok", r.ok);
            resp.put("msg", r.msg);
            return resp.toString();
        }

        resp.put("ok", false);
        resp.put("msg", "未知路径 " + method + " " + path);
        return resp.toString();
    }

    void sendResponse(Socket client, int status, String json) throws Exception {
        OutputStream out = client.getOutputStream();
        byte[] bodyBytes = json.getBytes("UTF-8");
        String head = "HTTP/1.1 " + status + " OK\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type\r\n" +
            // PNA：Chrome/WebView 对 HTTPS 页面 → localhost 的请求要求此头，缺失会被拦截
            "Access-Control-Allow-Private-Network: true\r\n" +
            "Content-Length: " + bodyBytes.length + "\r\n" +
            "Connection: close\r\n\r\n";
        out.write(head.getBytes("ASCII"));
        out.write(bodyBytes);
        out.flush();
    }

    void startForeground() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel("bridge", "桥接服务", NotificationManager.IMPORTANCE_LOW);
            nm.createNotificationChannel(ch);
        }
        Notification notif = new Notification.Builder(this, "bridge")
            .setContentTitle("PaperMarker 桥接运行中")
            .setContentText("localhost:3790 · 浏览器经桥接连 Brother 打印机")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build();
        startForeground(NOTIF_ID, notif);
    }

    @Override
    public void onDestroy() {
        running = false;
        try { if (server != null) server.close(); } catch (Exception e) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
