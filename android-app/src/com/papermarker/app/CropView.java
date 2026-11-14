package com.papermarker.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PointF;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

/**
 * 裁切视图：显示照片 + 半透明遮罩 + 可拖动四角框
 * 坐标系：对外暴露「位图坐标」，内部换算屏幕坐标
 */
public class CropView extends View {

    private Bitmap bitmap;
    private final PointF[] corners = new PointF[4]; // TL, TR, BR, BL（位图坐标）
    private float scale = 1f;
    private float offX = 0f, offY = 0f;
    private int activeIdx = -1;
    private OnCornerDragListener dragListener;

    private final Paint bmpPaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint dimPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint handlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint handleStroke = new Paint(Paint.ANTI_ALIAS_FLAG);

    public interface OnCornerDragListener {
        void onDrag();
    }

    public CropView(Context c, AttributeSet a) {
        super(c, a);
        dimPaint.setColor(0x99000000);
        dimPaint.setStyle(Paint.Style.FILL);
        linePaint.setColor(0xFF0E9F6E);
        linePaint.setStyle(Paint.Style.STROKE);
        linePaint.setStrokeWidth(4f);
        handlePaint.setColor(Color.WHITE);
        handlePaint.setStyle(Paint.Style.FILL);
        handleStroke.setColor(0xFF0E9F6E);
        handleStroke.setStyle(Paint.Style.STROKE);
        handleStroke.setStrokeWidth(5f);
    }

    public void setDragListener(OnCornerDragListener l) {
        this.dragListener = l;
    }

    /** 设置位图与四角（位图坐标），自动 fitCenter；pts 会先经 normalizeQuad 校验 */
    public void setBitmap(Bitmap bmp, PointF[] pts) {
        this.bitmap = bmp;
        PointF[] n = (pts == null) ? null : normalizeQuad(pts, bmp.getWidth(), bmp.getHeight());
        if (n == null) {
            // 默认内缩 8%（含传入四角校验失败时的兜底）
            float w = bmp.getWidth(), h = bmp.getHeight();
            float ix = w * 0.08f, iy = h * 0.08f;
            corners[0] = new PointF(ix, iy);
            corners[1] = new PointF(w - ix, iy);
            corners[2] = new PointF(w - ix, h - iy);
            corners[3] = new PointF(ix, h - iy);
        } else {
            for (int i = 0; i < 4; i++) corners[i] = new PointF(n[i].x, n[i].y);
        }
        requestLayout();
        invalidate();
    }

    public void setCorners(PointF[] pts) {
        if (pts == null || bitmap == null) return;
        PointF[] n = normalizeQuad(pts, bitmap.getWidth(), bitmap.getHeight());
        if (n == null) return; // 检测失败/退化四边形：保持现有四角不变
        for (int i = 0; i < 4; i++) corners[i].set(n[i].x, n[i].y);
        invalidate();
    }

    /**
     * 校验并规范化四边形：
     * 1. 每点 clamp 到 [8, bmpW-8] / [8, bmpH-8]，避免越界；
     * 2. 按相对质心的角度升序排序为 TL,TR,BR,BL（屏幕坐标 y 向下，角度 -π→π 依次对应四个象限），修复乱序；
     * 3. 鞋带公式面积 < 位图面积 15% 视为退化，返回 null。
     */
    public static PointF[] normalizeQuad(PointF[] pts, int bmpW, int bmpH) {
        if (pts == null || pts.length != 4) return null;
        float maxX = Math.max(8f, bmpW - 8f);
        float maxY = Math.max(8f, bmpH - 8f);
        PointF[] p = new PointF[4];
        for (int i = 0; i < 4; i++) {
            if (pts[i] == null) return null;
            p[i] = new PointF(clamp(pts[i].x, 8f, maxX), clamp(pts[i].y, 8f, maxY));
        }
        // 质心
        float cx = (p[0].x + p[1].x + p[2].x + p[3].x) / 4f;
        float cy = (p[0].y + p[1].y + p[2].y + p[3].y) / 4f;
        // 按相对质心的 atan2 角度升序：TL(-π..-π/2) TR(-π/2..0) BR(0..π/2) BL(π/2..π)
        for (int i = 0; i < 4; i++) {
            for (int j = i + 1; j < 4; j++) {
                double ai = Math.atan2(p[i].y - cy, p[i].x - cx);
                double aj = Math.atan2(p[j].y - cy, p[j].x - cx);
                if (aj < ai) {
                    PointF t = p[i];
                    p[i] = p[j];
                    p[j] = t;
                }
            }
        }
        // 鞋带公式面积，过小视为检测失败
        double area = 0;
        for (int i = 0; i < 4; i++) {
            PointF a = p[i];
            PointF b = p[(i + 1) % 4];
            area += (double) a.x * b.y - (double) b.x * a.y;
        }
        area = Math.abs(area) / 2.0;
        if (area < 0.15 * (double) bmpW * (double) bmpH) return null;
        return p;
    }

    public PointF[] getCorners() {
        PointF[] out = new PointF[4];
        for (int i = 0; i < 4; i++) out[i] = new PointF(corners[i].x, corners[i].y);
        return out;
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        computeTransform();
    }

    private void computeTransform() {
        if (bitmap == null || getWidth() == 0) return;
        float sw = (float) getWidth() / bitmap.getWidth();
        float sh = (float) getHeight() / bitmap.getHeight();
        // 0.88：留出边缘空隙，保证四角手柄（半径 22px）在纸张贴边时也完整可见
        scale = Math.min(sw, sh) * 0.88f;
        // 至少 48px 内边距（下限），避免手柄被屏幕/视图边缘裁掉
        offX = Math.max(48f, (getWidth() - bitmap.getWidth() * scale) / 2f);
        offY = Math.max(48f, (getHeight() - bitmap.getHeight() * scale) / 2f);
    }

    private float toScreenX(float bx) {
        return offX + bx * scale;
    }

    private float toScreenY(float by) {
        return offY + by * scale;
    }

    private float toBmpX(float sx) {
        return clamp((sx - offX) / scale, 0, bitmap.getWidth() - 1);
    }

    private float toBmpY(float sy) {
        return clamp((sy - offY) / scale, 0, bitmap.getHeight() - 1);
    }

    private static float clamp(float v, float lo, float hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (bitmap == null) return;
        canvas.drawColor(0xFF181A1F);

        // 图片
        Matrix m = new Matrix();
        m.postTranslate(offX, offY);
        m.preScale(scale, scale);
        canvas.drawBitmap(bitmap, m, bmpPaint);

        // 遮罩（四边形外变暗）
        Path mask = new Path();
        mask.setFillType(Path.FillType.EVEN_ODD);
        mask.addRect(0, 0, getWidth(), getHeight(), Path.Direction.CW);
        Path quad = new Path();
        quad.moveTo(toScreenX(corners[0].x), toScreenY(corners[0].y));
        quad.lineTo(toScreenX(corners[1].x), toScreenY(corners[1].y));
        quad.lineTo(toScreenX(corners[2].x), toScreenY(corners[2].y));
        quad.lineTo(toScreenX(corners[3].x), toScreenY(corners[3].y));
        quad.close();
        mask.addPath(quad);
        canvas.drawPath(mask, dimPaint);

        // 四边形描边
        linePaint.setStrokeWidth(activeIdx >= 0 ? 6f : 4f);
        canvas.drawPath(quad, linePaint);

        // 角点手柄
        float r = 22f;
        for (int i = 0; i < 4; i++) {
            float cx = toScreenX(corners[i].x);
            float cy = toScreenY(corners[i].y);
            canvas.drawCircle(cx, cy, r, handlePaint);
            canvas.drawCircle(cx, cy, r, handleStroke);
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (bitmap == null) return false;
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: {
                // 拖动四角时不允许父布局（如 ScrollView）拦截事件
                if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                float best = Float.MAX_VALUE;
                activeIdx = -1;
                for (int i = 0; i < 4; i++) {
                    float dx = event.getX() - toScreenX(corners[i].x);
                    float dy = event.getY() - toScreenY(corners[i].y);
                    float d = dx * dx + dy * dy;
                    if (d < best) {
                        best = d;
                        activeIdx = i;
                    }
                }
                // 触控半径 96px（手机上更好按）
                if (best > 96f * 96f) activeIdx = -1;
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                if (activeIdx >= 0) {
                    corners[activeIdx].set(toBmpX(event.getX()), toBmpY(event.getY()));
                    invalidate();
                    if (dragListener != null) dragListener.onDrag();
                }
                return true;
            }
            case MotionEvent.ACTION_UP:
            case MotionEvent.ACTION_CANCEL:
                activeIdx = -1;
                invalidate();
                return true;
        }
        return super.onTouchEvent(event);
    }
}
