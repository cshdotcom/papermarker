package com.papermarker.bridge;

import java.io.*;
import java.net.*;
import java.util.concurrent.*;
import java.util.*;

/**
 * Brother TCP 协议实现（Android Java 版）。
 *
 * 协议来源：iPrint&Scan 6.14.2 SDK 字节码逆向，DCP-T428W 真机已打通。
 * 帧格式：1B <命令字符> 0A + ASCII 正文 + 80
 * 实测最小流程：TCP connect → 等 "+OK 200" → 直接发 ESC X → 进入图像流
 *
 * 图像流块结构：
 *  - 0x64 = JPEG 数据块（9 字节剩余头 + 2 字节块长 + 数据）
 *  - 0x80 = 全部结束
 *  - 0x82 = 本页结束
 *  - 0x83 = 全部页结束
 *  - 0x81/0x84-0x87 = 其他控制头（1+2 字节 + 可选数据）
 */
public class BrotherTcp {

    static final int SCAN_PORT = 54921;
    static final int PRINT_PORT = 9100;
    static final byte[] UEL = {0x1b, 0x25, 0x2d, 0x31, 0x32, 0x33, 0x34, 0x35, 0x58};

    // ---------- TCP 连接 ----------
    static Socket connect(String host, int port, int timeoutMs) throws IOException {
        Socket sock = new Socket();
        sock.connect(new InetSocketAddress(host, port), timeoutMs);
        sock.setSoTimeout(timeoutMs);
        return sock;
    }

    // ---------- 发送 ESC 帧 ----------
    static void sendFrame(OutputStream out, char cmd, String body) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        bos.write(0x1b);
        bos.write((int) cmd);
        bos.write(0x0a);
        bos.write(body.getBytes("ASCII"));
        bos.write(0x80);
        out.write(bos.toByteArray());
        out.flush();
    }

    // ---------- 精确读取 N 字节 ----------
    static byte[] readExact(InputStream in, int n, int timeoutMs) throws IOException {
        byte[] buf = new byte[n];
        int off = 0;
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (off < n) {
            int remaining = n - off;
            int left = (int) (deadline - System.currentTimeMillis());
            if (left <= 0) throw new IOException("读取超时");
            int r = in.read(buf, off, remaining);
            if (r < 0) throw new IOException("连接中断（设备拒绝或会话被占用）");
            off += r;
        }
        return buf;
    }

    static String readLine(InputStream in, int timeoutMs) throws IOException {
        long deadline = System.currentTimeMillis() + timeoutMs;
        StringBuilder sb = new StringBuilder();
        while (true) {
            int left = (int) (deadline - System.currentTimeMillis());
            if (left <= 0) throw new IOException("等待欢迎语超时（设备忙或被占用）");
            int b = in.read();
            if (b < 0) throw new IOException("连接中断");
            if (b == 0x0a) break;
            if (b != 0x0d) sb.append((char) b);
        }
        return sb.toString();
    }

    static int mm2px(double mm, int dpi) {
        return (int) Math.round((mm / 25.4) * dpi);
    }

    // ---------- Brother 扫描 ----------
    public static class ScanResult {
        public boolean ok;
        public String msg;
        public List<byte[]> pages = new ArrayList<>();
        public List<String> trace = new ArrayList<>();
    }

    public static ScanResult scan(String host, String colorMode, int dpi, String source) {
        ScanResult result = new ScanResult();
        Socket sock = null;
        try {
            String mode = colorMode != null ? colorMode : "CGRAY";
            boolean feeder = "Feeder".equals(source);
            int d = dpi > 0 ? dpi : 300;

            sock = connect(host, SCAN_PORT, 4000);
            InputStream in = sock.getInputStream();
            OutputStream out = sock.getOutputStream();

            String welcome = readLine(in, 4000);
            result.trace.add("welcome: " + welcome);
            if (!welcome.startsWith("+")) {
                result.msg = "设备未就绪：" + welcome;
                return result;
            }

            int w = mm2px(210, d);
            int h = mm2px(297, d);
            String xb = "R=" + d + "," + d + "\nM=" + mode + "\nC=JPEG\nJ=MID\n" +
                        "B=50\nN=50\nA=0,0," + w + "," + h + "\nD=SIN\nG=1\nL=128\n";
            sendFrame(out, 'X', xb);
            result.trace.add("ESC X 已发送（" + d + "dpi " + mode + "）");

            boolean isColor = "C256".equals(mode) || "ERRDIF".equals(mode);
            int chunkTimeout = isColor ? 90000 : 45000;

            ByteArrayOutputStream cur = new ByteArrayOutputStream();
            while (true) {
                byte[] headBuf = readExact(in, 1, chunkTimeout);
                int id = headBuf[0] & 0xff;

                if (id == 0x80) {
                    if (cur.size() > 0) result.pages.add(cur.toByteArray());
                    result.trace.add("扫描结束（0x80）");
                    break;
                }

                if (id == 0x82 || id == 0x83) {
                    byte[] lb = readExact(in, 2, 5000);
                    int n = (lb[0] & 0xff) | ((lb[1] & 0xff) << 8);
                    if (n > 0) readExact(in, n, 10000);
                    if (cur.size() > 0) {
                        result.pages.add(cur.toByteArray());
                        cur.reset();
                    }
                    result.trace.add("页结束（0x" + Integer.toHexString(id) + "）");
                    if (id == 0x83) break;
                    if (!feeder) break;
                    continue;
                }

                if ((id & 0x80) != 0) {
                    byte[] lb = readExact(in, 2, 5000);
                    int n = (lb[0] & 0xff) | ((lb[1] & 0xff) << 8);
                    if (n > 0) readExact(in, n, 10000);
                    continue;
                }

                if (id == 0x64) {
                    byte[] restHdr = readExact(in, 9, chunkTimeout);
                    int pageId = (restHdr[2] & 0xff) | ((restHdr[3] & 0xff) << 8);
                    byte[] lb = readExact(in, 2, 10000);
                    int len = (lb[0] & 0xff) | ((lb[1] & 0xff) << 8);
                    if (len == 0) continue;
                    byte[] payload = readExact(in, len, chunkTimeout);
                    cur.write(payload);
                    if (result.trace.size() < 30)
                        result.trace.add("已接收 " + cur.size() + " 字节（页 " + pageId + "）");
                    continue;
                }

                // 其他数据块
                byte[] lb = readExact(in, 2, 10000);
                int len = (lb[0] & 0xff) | ((lb[1] & 0xff) << 8);
                if (len > 0) {
                    byte[] payload = readExact(in, len, chunkTimeout);
                    cur.write(payload);
                }
            }

            // 校验 JPEG
            List<byte[]> valid = new ArrayList<>();
            for (byte[] p : result.pages) {
                if (p.length > 100 && (p[0] & 0xff) == 0xff && (p[1] & 0xff) == 0xd8) {
                    valid.add(p);
                }
            }
            if (valid.isEmpty()) {
                result.msg = "未收到有效图像（平板未放稿 / 会话被占用）";
                return result;
            }
            result.pages = valid;
            result.ok = true;
            result.msg = "扫描完成，共 " + valid.size() + " 页（" + d + "dpi）";
        } catch (Exception e) {
            result.msg = "扫描异常：" + e.getMessage();
        } finally {
            try { if (sock != null) sock.close(); } catch (Exception e) {}
        }
        return result;
    }

    // ---------- Brother 直连打印 ----------
    public static ScanResult print(String host, List<byte[]> jpegs, String jobName) {
        ScanResult result = new ScanResult();
        Socket sock = null;
        try {
            if (jpegs.isEmpty()) {
                result.msg = "没有可打印的页面";
                return result;
            }
            sock = connect(host, PRINT_PORT, 5000);
            OutputStream out = sock.getOutputStream();
            for (int i = 0; i < jpegs.size(); i++) {
                String pjl = "\n@PJL JOB NAME=\"" + (jobName != null ? jobName : "PaperMarker") + "-" + (i + 1) + "\"\n@PJL ENTER LANGUAGE=JPEG\n";
                ByteArrayOutputStream head = new ByteArrayOutputStream();
                head.write(UEL);
                head.write(pjl.getBytes("ASCII"));
                out.write(head.toByteArray());
                out.write(jpegs.get(i));
                out.write(UEL);
            }
            out.flush();
            sock.shutdownOutput();
            Thread.sleep(2000); // 给打印机处理时间
            result.ok = true;
            result.msg = "已向 " + host + ":9100 下发 " + jpegs.size() + " 页直连打印任务";
        } catch (Exception e) {
            result.msg = "Brother 直连打印失败：" + e.getMessage();
        } finally {
            try { if (sock != null) sock.close(); } catch (Exception e) {}
        }
        return result;
    }

    // ---------- 探测 ----------
    public static ScanResult probeScanner(String host) {
        ScanResult result = new ScanResult();
        Socket sock = null;
        try {
            sock = connect(host, SCAN_PORT, 3000);
            String welcome = readLine(sock.getInputStream(), 3000);
            result.trace.add("welcome: " + welcome);
            if (!welcome.startsWith("+")) {
                result.msg = "设备未就绪：" + welcome;
                return result;
            }
            sendFrame(sock.getOutputStream(), 'D', "AUTO\n");
            byte[] st = readExact(sock.getInputStream(), 1, 3000);
            result.trace.add("ESC D -> 0x" + Integer.toHexString(st[0] & 0xff));
            if ((st[0] & 0xff) != 0x80) {
                result.msg = "纸源设置失败";
                return result;
            }
            result.ok = true;
            result.msg = "Brother 扫描服务连通（" + host + ":54921）";
        } catch (Exception e) {
            result.msg = "探测失败：" + e.getMessage();
        } finally {
            try { if (sock != null) sock.close(); } catch (Exception e) {}
        }
        return result;
    }

    public static ScanResult probePrinter(String host) {
        ScanResult result = new ScanResult();
        Socket sock = null;
        try {
            sock = connect(host, PRINT_PORT, 3000);
            result.ok = true;
            result.msg = "打印机 " + host + ":9100 端口可达";
        } catch (Exception e) {
            result.msg = "打印机 " + host + ":9100 连接失败：" + e.getMessage();
        } finally {
            try { if (sock != null) sock.close(); } catch (Exception e) {}
        }
        return result;
    }
}
