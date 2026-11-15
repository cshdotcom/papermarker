package com.papermarker.bridge;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import java.io.*;
import java.net.*;
import java.util.concurrent.*;
import java.util.*;

/**
 * Brother TCP 协议实现（Android Java 版）v2.0.0。
 *
 * 扫描协议来源：iPrint&Scan 6.14.2 SDK 字节码逆向，DCP-T428W 真机已打通。
 * 帧格式：1B <命令字符> 0A + ASCII 正文 + 80
 * 实测最小流程：TCP connect → 等 "+OK 200" → 直接发 ESC X → 进入图像流
 *
 * 打印协议（v2.0.0 重写）：
 *  Brother 喷墨固件 PJL 只认 `@PJL ENTER LANGUAGE=PWGRASTER`。
 *  旧版 `ENTER LANGUAGE=JPEG` 不是注册的 language name，被固件静默丢弃
 *  （这正是「安卓根本没有向打印机发送」的协议层根因之一）。
 *  正确流：UEL + @PJL 头 + PWGRASTER + "RaS2" + 1796B 页头 + RLE 行块 + UEL×2。
 *  协议来源：官方 brdcpt230filter 逐字节逆向（github.com/vituxdxd/brother-dcpt230），
 *  DCP-T230/T420W/T428W 同引擎代通用。
 *
 * 图像流（扫描）块结构：
 *  - 0x64 = JPEG 数据块（9 字节剩余头 + 2 字节块长 + 数据）
 *  - 0x80 = 全部结束
 *  - 0x82 = 本页结束
 *  - 0x83 = 全部页结束
 *  - 0x81/0x84-0x87 = 其他控制头（1+2 字节 + 可选数据）
 */
public class BrotherTcp {

    static final int SCAN_PORT = 54921;
    static final int PRINT_PORT = 9100;
    static final int A4_DPI = 300;
    static final int A4_WIDTH = 2480;   // A4 @300dpi（官方驱动固定值）
    static final int A4_HEIGHT = 3507;
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

    // ---------- 结果 ----------
    public static class ScanResult {
        public boolean ok;
        public String msg;
        public List<byte[]> pages = new ArrayList<>();
        public List<String> trace = new ArrayList<>();
    }

    // ---------- Brother 扫描 ----------
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

    // ==================== PWG Raster 打印（v2.0.0） ====================

    /** 1796 字节 PWG 页头 */
    static byte[] buildPageHeader(int width, int height, int dpi) {
        byte[] h = new byte[1796];
        byte[] magic = "PwgRaster".getBytes();
        System.arraycopy(magic, 0, h, 0, magic.length);       // 0x000 MediaClass
        byte[] media = "auto".getBytes();
        System.arraycopy(media, 0, h, 128, media.length);      // 0x080 MediaType
        be32(h, 0x114, dpi);                                   // 分辨率 X
        be32(h, 0x118, dpi);                                   // 分辨率 Y
        be32(h, 0x160, Math.round((width * 72f) / dpi));       // 纸宽（pt）
        be32(h, 0x164, Math.round((height * 72f) / dpi));      // 纸高（pt）
        be32(h, 0x174, width);                                 // 光栅宽
        be32(h, 0x178, height);                                // 光栅高
        be32(h, 0x180, 8);                                     // bits per channel
        be32(h, 0x184, 24);                                    // bits per pixel
        be32(h, 0x188, width * 3);                             // bytes per line
        be32(h, 0x190, 19);                                    // sRGB
        be32(h, 0x1a4, 3);                                     // 3 色
        return h;
    }

    static void be32(byte[] h, int off, int v) {
        h[off]     = (byte) ((v >>> 24) & 0xff);
        h[off + 1] = (byte) ((v >>> 16) & 0xff);
        h[off + 2] = (byte) ((v >>> 8) & 0xff);
        h[off + 3] = (byte) (v & 0xff);
    }

    /** 单行 RLE 编码（RGB，与官方 filter 一致：重复游程上限 128 像素，0x80 永不出现） */
    static byte[] rleEncodeLine(byte[] line, int width) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(64, width / 2));
        final int unit = 3;
        int i = 0;
        while (i < width) {
            int cur = i * unit;
            if (i + 1 < width && pixelEq(line, cur, cur + unit)) {
                int n = 2;
                while (i + n < width && n < 128 && pixelEq(line, cur, (i + n) * unit)) n++;
                out.write(n - 1);
                out.write(line, cur, unit);
                i += n;
            } else {
                int n = 1;
                while (i + n < width && n < 128
                        && !(i + n + 1 < width && pixelEq(line, (i + n) * unit, (i + n + 1) * unit))) n++;
                if (n == 1) out.write(0x00);
                else out.write(0x101 - n);
                out.write(line, cur, n * unit);
                i += n;
            }
        }
        return out.toByteArray();
    }

    static boolean pixelEq(byte[] line, int a, int b) {
        return line[a] == line[b] && line[a + 1] == line[b + 1] && line[a + 2] == line[b + 2];
    }

    /** JPEG byte[] → A4 @300dpi RGB（BitmapFactory 解码 + 白底信箱缩放） */
    static byte[] jpegToA4Raster(byte[] jpeg) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, bounds);
        int sw = bounds.outWidth > 0 ? bounds.outWidth : A4_WIDTH;
        int sh = bounds.outHeight > 0 ? bounds.outHeight : A4_HEIGHT;

        // 采样降低解码内存：目标解码尺寸略大于 A4 即可
        int inSample = 1;
        while (sw / (inSample * 2) >= A4_WIDTH && sh / (inSample * 2) >= A4_HEIGHT) inSample *= 2;

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = inSample;
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap src = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length, opts);
        if (src == null) throw new IllegalArgumentException("JPEG 解码失败");
        int srcW = src.getWidth(), srcH = src.getHeight();

        // 白底 A4 + 保持纵横比居中缩放
        Bitmap dst = Bitmap.createBitmap(A4_WIDTH, A4_HEIGHT, Bitmap.Config.ARGB_8888);
        Canvas cv = new Canvas(dst);
        cv.drawColor(Color.WHITE);
        Paint p = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
        float scale = Math.min((float) A4_WIDTH / srcW, (float) A4_HEIGHT / srcH);
        int dw = Math.max(1, Math.round(srcW * scale));
        int dh = Math.max(1, Math.round(srcH * scale));
        int dx = (A4_WIDTH - dw) / 2;
        int dy = (A4_HEIGHT - dh) / 2;
        RectFHelper.drawScaled(cv, src, dx, dy, dw, dh, p);
        src.recycle();

        // ARGB int[] → RGB byte[]
        int[] px = new int[A4_WIDTH * A4_HEIGHT];
        dst.getPixels(px, 0, A4_WIDTH, 0, 0, A4_WIDTH, A4_HEIGHT);
        dst.recycle();
        byte[] rgb = new byte[A4_WIDTH * A4_HEIGHT * 3];
        for (int i2 = 0, q = 0; i2 < px.length; i2++, q += 3) {
            int c = px[i2];
            rgb[q]     = (byte) ((c >> 16) & 0xff); // R
            rgb[q + 1] = (byte) ((c >> 8) & 0xff);  // G
            rgb[q + 2] = (byte) (c & 0xff);         // B
        }
        return rgb;
    }

    /** 兼容辅助（避免额外 import android.graphics.RectF） */
    static class RectFHelper {
        static void drawScaled(Canvas cv, Bitmap src, int dx, int dy, int dw, int dh, Paint p) {
            android.graphics.RectF dstRect = new android.graphics.RectF(dx, dy, dx + dw, dy + dh);
            cv.drawBitmap(src, null, dstRect, p);
        }
    }

    /** 编码一页：页头 + 行块（rc 仅 0/1） */
    static byte[] encodePage(byte[] rgb, int width, int height, int dpi) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(1 << 20);
        try {
            out.write(buildPageHeader(width, height, dpi));
        } catch (IOException ignore) {}
        byte[] prevLine = null;
        byte[] prevRle = null;
        int rc = 0;
        for (int y = 0; y < height; y++) {
            int off = y * width * 3;
            byte[] line = new byte[width * 3];
            System.arraycopy(rgb, off, line, 0, width * 3);
            if (prevLine != null && rc == 0 && Arrays.equals(line, prevLine)) {
                rc = 1;
                continue;
            }
            if (prevLine != null) {
                try {
                    out.write(rc);
                    out.write(prevRle != null ? prevRle : rleEncodeLine(prevLine, width));
                } catch (IOException ignore) {}
            }
            prevLine = line;
            prevRle = null;
            rc = 0;
        }
        if (prevLine != null) {
            try {
                out.write(rc);
                out.write(prevRle != null ? prevRle : rleEncodeLine(prevLine, width));
            } catch (IOException ignore) {}
        }
        return out.toByteArray();
    }

    /** PJL 前导（UEL 起始，进入 PWGRASTER） */
    static byte[] buildPreamble(String jobName) {
        String name = jobName == null ? "PaperMarker" : jobName.replaceAll("[\"\\\\\\r\\n]", " ");
        if (name.length() > 60) name = name.substring(0, 60);
        // JOBSETTINGLOG DRIVER：I + 型号(7) + "11" + media/quality/paper/color/duplex/slot 各4位HEX
        String driver = "I0004036110000000100020009000200000007";
        StringBuilder sb = new StringBuilder();
        sb.append("@PJL \n");
        sb.append("@PJL SET HOLD=OFF\n");
        sb.append("@PJL SET STRINGCODESET=UTF8\n");
        sb.append("@PJL SET JOBNAME=\"").append(name).append("\"\n");
        sb.append("@PJL SET PAPER=A4\n");
        sb.append("@PJL SET BORDERLESS=OFF\n");
        sb.append("@PJL SET JTTOPMARGIN=300\n");
        sb.append("@PJL SET JTBOTMARGIN=300\n");
        sb.append("@PJL SET JTLEFTMARGIN=300\n");
        sb.append("@PJL SET JTRIGHTMARGIN=300\n");
        sb.append("@PJL SET RENDERMODE=COLOR\n");
        sb.append("@PJL SET PRINTQUALITY=NORMAL\n");
        sb.append("@PJL SET DUPLEX=OFF\n");
        sb.append("@PJL SET MEDIATYPE=REGULAR\n");
        sb.append("@PJL SET MANUALFEED=OFF\n");
        sb.append("@PJL SET SOURCETRAY=AUTO\n");
        sb.append("@PJL JOBSETTINGLOG DRIVER=").append(driver).append("\n");
        sb.append("@PJL SET FIDELITY=TRUE\n");
        sb.append("@PJL ENTER LANGUAGE=PWGRASTER\n");
        byte[] head = sb.toString().getBytes();
        byte[] all = new byte[UEL.length + head.length];
        System.arraycopy(UEL, 0, all, 0, UEL.length);
        System.arraycopy(head, 0, all, UEL.length, head.length);
        return all;
    }

    // ---------- Brother 直连打印（PWGRASTER，v2.0.0） ----------
    public static ScanResult print(String host, List<byte[]> jpegs, String jobName) {
        ScanResult result = new ScanResult();
        Socket sock = null;
        try {
            if (jpegs.isEmpty()) {
                result.msg = "没有可打印的页面";
                return result;
            }
            result.trace.add("光栅化 " + jpegs.size() + " 页 → A4 " + A4_DPI + "dpi");

            sock = connect(host, PRINT_PORT, 8000);
            sock.setSendBufferSize(512 * 1024);
            OutputStream out = new BufferedOutputStream(sock.getOutputStream(), 256 * 1024);

            // PJL 前导 + RaS2（整任务一次）
            out.write(buildPreamble(jobName));
            out.write("RaS2".getBytes("ASCII"));

            // 每页：1796B 页头 + RLE 行块
            for (int i = 0; i < jpegs.size(); i++) {
                byte[] rgb = jpegToA4Raster(jpegs.get(i));
                byte[] pageData = encodePage(rgb, A4_WIDTH, A4_HEIGHT, A4_DPI);
                out.write(pageData);
                out.flush();
                result.trace.add("页 " + (i + 1) + " 已编码发送（" + pageData.length / 1024 + "KB）");
            }

            // 尾部：UEL + EOJ + UEL
            String name = jobName == null ? "PaperMarker" : jobName.replaceAll("[\"\\\\\\r\\n]", " ");
            out.write(UEL);
            out.write(("@PJL EOJ NAME=\"" + name + "\"\r\n").getBytes("ASCII"));
            out.write(UEL);
            out.flush();
            Thread.sleep(1500); // 给打印机接收缓冲处理时间
            result.ok = true;
            result.msg = "已向 " + host + ":9100 下发 " + jpegs.size() + " 页打印任务（PWGRASTER 协议）";
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
