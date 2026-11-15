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
 * 接口：
 *  GET  /ping          健康检查
 *  POST /scan          Brother 扫描 → 返回 base64 JPEG 数组
 *  POST /print         Brother 直连打印
 *  POST /probe/scan    探测扫描仪
 *  POST /probe/print   探测打印机
 */
public class BridgeService extends Service {
    static final String TAG = "BridgeService";
    static final int PORT = 3790;
    static final int NOTIF_ID = 1;

    private ServerSocket server;
    private boolean running = false;
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

    void handle(Socket client) {
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream()));
            String line = reader.readLine();
            if (line == null) return;
            String[] parts = line.split(" ");
            String method = parts[0];
            String path = parts[1];
            int contentLength = 0;
            // 读 headers
            while (!(line = reader.readLine()).isEmpty()) {
                int ci = line.toLowerCase().indexOf("content-length:");
                if (ci >= 0) {
                    contentLength = Integer.parseInt(line.substring(ci + 15).trim());
                }
            }
            byte[] body = null;
            if (contentLength > 0) {
                body = new byte[contentLength];
                int off = 0;
                while (off < contentLength) {
                    int r = client.getInputStream().read(body, off, contentLength - off);
                    if (r < 0) break;
                    off += r;
                }
            }

            // CORS preflight
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
                err.put("ok", false);
                err.put("msg", "处理异常：" + e.getMessage());
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
            r.put("version", "1.0.0");
            r.put("port", PORT);
            return r.toString();
        }

        JSONObject req = body != null && body.length > 0 ? new JSONObject(new String(body, "UTF-8")) : new JSONObject();
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
        String head = "HTTP/1.1 " + status + " OK\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type\r\n" +
            "Content-Length: " + json.getBytes("UTF-8").length + "\r\n" +
            "Connection: close\r\n\r\n";
        out.write(head.getBytes("ASCII"));
        out.write(json.getBytes("UTF-8"));
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
