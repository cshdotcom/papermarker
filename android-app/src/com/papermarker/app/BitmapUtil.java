package com.papermarker.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.PointF;
import android.graphics.RectF;

import java.io.File;
import java.io.FileOutputStream;

/** 位图工具：采样加载 / 旋转 / 透视矫正 / 黑白增强 / JPEG 保存 */
public class BitmapUtil {

    /** 按最大边采样加载，节省内存 */
    public static Bitmap loadDownscaled(String path, int maxEdge) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, o);
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / sample > maxEdge * 2) sample *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = sample;
        Bitmap b = BitmapFactory.decodeFile(path, o2);
        if (b == null) return null;
        float scale = Math.min(1f, (float) maxEdge / Math.max(b.getWidth(), b.getHeight()));
        if (scale < 0.95f) {
            Bitmap s = Bitmap.createScaledBitmap(b, Math.round(b.getWidth() * scale), Math.round(b.getHeight() * scale), true);
            if (s != b) b.recycle();
            b = s;
        }
        return b;
    }

    /** 生成缩略图 */
    public static Bitmap thumbnail(String path, int edge) {
        Bitmap b = loadDownscaled(path, edge);
        return b;
    }

    /** 旋转 90°（顺时针），返回新位图 */
    public static Bitmap rotate90(Bitmap src) {
        Matrix m = new Matrix();
        m.postRotate(90);
        Bitmap out = Bitmap.createBitmap(src, 0, 0, src.getWidth(), src.getHeight(), m, true);
        return out;
    }

    /** 旋转 90° 后坐标变换：(x,y) → (H-1-y, x) */
    public static PointF rotatePoint(PointF p, int oldW, int oldH) {
        return new PointF(oldH - 1 - p.y, p.x);
    }

    /**
     * 透视矫正：四角 → 矩形
     * 输出尺寸按四边平均长度计算；接近 A4 比例时自动吸附 A4；
     * bwMode=true 时做黑白增强（去底色阴影，适合试卷文字扫描）
     */
    public static Bitmap warp(Bitmap src, PointF[] corners, boolean bwMode) {
        float topW = dist(corners[0], corners[1]);
        float botW = dist(corners[3], corners[2]);
        float leftH = dist(corners[0], corners[3]);
        float rightH = dist(corners[1], corners[2]);
        float outW = (topW + botW) / 2f;
        float outH = (leftH + rightH) / 2f;
        if (outW < 32 || outH < 32) return null;

        // A4 比例吸附（210:297 ≈ 0.7071），偏差 18% 内吸附
        float ratio = outW / outH;
        if (Math.abs(ratio - 0.7071f) < 0.7071f * 0.18f) {
            outH = outW / 0.7071f;
        }

        // 长边限制 2000px
        float cap = 2000f;
        float s = Math.min(1f, cap / Math.max(outW, outH));
        int w = Math.round(outW * s);
        int h = Math.round(outH * s);

        float[] srcPts = new float[8];
        for (int i = 0; i < 4; i++) {
            srcPts[i * 2] = corners[i].x;
            srcPts[i * 2 + 1] = corners[i].y;
        }
        float[] dstPts = new float[]{0, 0, w, 0, w, h, 0, h};

        Matrix m = new Matrix();
        if (!m.setPolyToPoly(srcPts, 0, dstPts, 0, 4)) return null;

        Bitmap out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        c.drawColor(android.graphics.Color.WHITE);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        if (bwMode) p.setColorFilter(new ColorMatrixColorFilter(bwMatrix()));
        c.drawBitmap(src, m, p);
        return out;
    }

    /** 黑白增强：去色 + 拉对比度（文字更清晰，接近扫描仪效果） */
    private static ColorMatrix bwMatrix() {
        ColorMatrix sat = new ColorMatrix();
        sat.setSaturation(0);
        ColorMatrix contrast = new ColorMatrix(new float[]{
                1.38f, 0, 0, 0, -48f,
                0, 1.38f, 0, 0, -48f,
                0, 0, 1.38f, 0, -48f,
                0, 0, 0, 1f, 0
        });
        sat.postConcat(contrast);
        return sat;
    }

    /** 保存 JPEG */
    public static File saveJpeg(Bitmap bmp, File dest, int quality) throws Exception {
        FileOutputStream fos = new FileOutputStream(dest);
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, fos);
        fos.flush();
        fos.close();
        return dest;
    }

    private static float dist(PointF a, PointF b) {
        float dx = a.x - b.x, dy = a.y - b.y;
        return (float) Math.sqrt(dx * dx + dy * dy);
    }

    /** 空安全取矩形 */
    public static RectF toRect(PointF[] pts) {
        RectF r = new RectF();
        for (PointF p : pts) r.union(p.x, p.y);
        return r;
    }
}
