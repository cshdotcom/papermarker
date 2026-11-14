package com.papermarker.app;

import android.graphics.Bitmap;
import android.graphics.PointF;

/**
 * 试卷纸张边缘检测（纯 Java 实现）：
 * 1. 降采样 → 灰度 → Otsu 自适应阈值二值化（纸张通常比背景亮）
 * 2. 最大亮色连通域 = 纸张区域
 * 3. 连通域四个极值角点：TL=min(x+y) TR=max(x-y) BR=max(x+y) BL=min(x-y)
 * 不满足面积/形状约束时返回 null（回退默认四角，由用户手动拖动）
 */
public class DocDetector {

    /** 返回 4 角 [TL, TR, BR, BL]（原图坐标系），失败返回 null */
    public static PointF[] detect(Bitmap src) {
        try {
            int W = src.getWidth(), H = src.getHeight();
            // 降采样到长边 256
            float scale = 256f / Math.max(W, H);
            int w = Math.max(2, Math.round(W * scale));
            int h = Math.max(2, Math.round(H * scale));
            Bitmap small = Bitmap.createScaledBitmap(src, w, h, true);
            int[] px = new int[w * h];
            small.getPixels(px, 0, w, 0, 0, w, h);

            // 灰度 + 直方图
            int[] gray = new int[w * h];
            int[] hist = new int[256];
            for (int i = 0; i < px.length; i++) {
                int c = px[i];
                int r = (c >> 16) & 0xFF, g = (c >> 8) & 0xFF, b = c & 0xFF;
                int y = (r * 299 + g * 587 + b * 114) / 1000;
                gray[i] = y;
                hist[y]++;
            }

            // Otsu 阈值
            int thr = otsu(hist, px.length);

            // 二值化：亮 = 纸
            byte[] bin = new byte[w * h];
            int bright = 0;
            for (int i = 0; i < px.length; i++) {
                if (gray[i] > thr) {
                    bin[i] = 1;
                    bright++;
                }
            }
            // 整页几乎全亮（纸张占满）或太暗 → 无法可靠检测
            if (bright < px.length * 0.08 || bright > px.length * 0.97) return null;

            // 最大连通域（4 连通，BFS）
            int[] label = new int[w * h];
            int[] queue = new int[w * h];
            int bestLabel = 0, bestArea = 0, nextLabel = 0;
            for (int start = 0; start < w * h; start++) {
                if (bin[start] == 0 || label[start] != 0) continue;
                nextLabel++;
                int head = 0, tail = 0;
                queue[tail++] = start;
                label[start] = nextLabel;
                int area = 0;
                while (head < tail) {
                    int p = queue[head++];
                    area++;
                    int x = p % w, y = p / w;
                    if (x > 0 && bin[p - 1] == 1 && label[p - 1] == 0) { label[p - 1] = nextLabel; queue[tail++] = p - 1; }
                    if (x < w - 1 && bin[p + 1] == 1 && label[p + 1] == 0) { label[p + 1] = nextLabel; queue[tail++] = p + 1; }
                    if (y > 0 && bin[p - w] == 1 && label[p - w] == 0) { label[p - w] = nextLabel; queue[tail++] = p - w; }
                    if (y < h - 1 && bin[p + w] == 1 && label[p + w] == 0) { label[p + w] = nextLabel; queue[tail++] = p + w; }
                }
                if (area > bestArea) {
                    bestArea = area;
                    bestLabel = nextLabel;
                }
            }
            if (bestLabel == 0) return null;
            // 纸张区域至少占 12%
            if (bestArea < px.length * 0.12) return null;

            // 四角极值点
            int tl = -1, tr = -1, br = -1, bl = -1;
            long tlV = Long.MAX_VALUE, trV = Long.MIN_VALUE, brV = Long.MIN_VALUE, blV = Long.MAX_VALUE;
            for (int i = 0; i < w * h; i++) {
                if (label[i] != bestLabel) continue;
                int x = i % w, y = i / w;
                long s = x + (long) y, d = x - (long) y;
                if (s < tlV) { tlV = s; tl = i; }
                if (s > brV) { brV = s; br = i; }
                if (d > trV) { trV = d; tr = i; }
                if (d < blV) { blV = d; bl = i; }
            }
            if (tl < 0 || tr < 0 || br < 0 || bl < 0) return null;

            // 映射回原图坐标
            float inv = 1f / scale;
            PointF[] pts = new PointF[4];
            int[] idx = {tl, tr, br, bl};
            for (int k = 0; k < 4; k++) {
                float x = (idx[k] % w) * inv;
                float y = (idx[k] / w) * inv;
                pts[k] = new PointF(clamp(x, 0, W - 1), clamp(y, 0, H - 1));
            }

            // 形状约束：四边形每条边不小于短边的 25%，且四角互不重合
            float minDim = Math.min(W, H);
            if (dist(pts[0], pts[1]) < minDim * 0.25f
                    || dist(pts[1], pts[2]) < minDim * 0.25f
                    || dist(pts[2], pts[3]) < minDim * 0.25f
                    || dist(pts[3], pts[0]) < minDim * 0.25f) {
                return null;
            }
            return pts;
        } catch (Throwable t) {
            return null;
        }
    }

    private static int otsu(int[] hist, int total) {
        double sum = 0;
        for (int i = 0; i < 256; i++) sum += (long) i * hist[i];
        double sumB = 0;
        int wB = 0;
        double maxVar = -1;
        int threshold = 127;
        for (int t = 0; t < 256; t++) {
            wB += hist[t];
            if (wB == 0) continue;
            int wF = total - wB;
            if (wF == 0) break;
            sumB += (long) t * hist[t];
            double mB = sumB / wB;
            double mF = (sum - sumB) / wF;
            double between = (double) wB * wF * (mB - mF) * (mB - mF);
            if (between > maxVar) {
                maxVar = between;
                threshold = t;
            }
        }
        return threshold;
    }

    private static float dist(PointF a, PointF b) {
        float dx = a.x - b.x, dy = a.y - b.y;
        return (float) Math.sqrt(dx * dx + dy * dy);
    }

    private static float clamp(float v, float lo, float hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }
}
