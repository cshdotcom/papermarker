package com.papermarker.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 批注视图：试卷原图 + 题框 + 判分标记（√ / × / 勾上叉）+ 得分
 * 判分符号几何与网页端 / PDF 端完全一致
 */
public class MarksView extends View {

    /** 轻量批注数据 */
    public static class Ann {
        public String id;
        public String questionText = "";
        public String judgeType = "correct";
        public String briefReason;
        public String answerText;
        public String fullSolution;
        public float roiX, roiY, roiW, roiH;
        public int fullScore, getScore;
    }

    public interface OnAnnTap {
        void onAnnTap(Ann ann);
    }

    private Bitmap bitmap;
    private final List<Ann> anns = new ArrayList<>();
    private OnAnnTap tapListener;

    private float scale = 1f;
    private float offX, offY;
    private int drawW, drawH;

    private final Paint bmpPaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint boxPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint markPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint chipPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    public MarksView(Context c, AttributeSet a) {
        super(c, a);
        boxPaint.setStyle(Paint.Style.STROKE);
        boxPaint.setColor(0xFF2563EB);
        boxPaint.setStrokeWidth(3f);
        markPaint.setStyle(Paint.Style.STROKE);
        markPaint.setStrokeCap(Paint.Cap.ROUND);
        markPaint.setStrokeJoin(Paint.Join.ROUND);
        chipPaint.setColor(0xE61F2937);
        textPaint.setColor(Color.WHITE);
    }

    public void setTapListener(OnAnnTap l) {
        this.tapListener = l;
    }

    public void setContent(Bitmap bmp, List<Ann> list) {
        this.bitmap = bmp;
        anns.clear();
        if (list != null) anns.addAll(list);
        requestLayout();
        invalidate();
    }

    public static Ann parseAnn(JSONObject a) {
        Ann ann = new Ann();
        ann.id = a.optString("id");
        ann.questionText = a.optString("questionText", "");
        ann.judgeType = a.optString("judgeType", "correct");
        ann.briefReason = a.optString("briefReason", null);
        ann.answerText = a.optString("answerText", null);
        ann.fullSolution = a.optString("fullSolution", null);
        ann.fullScore = a.optInt("fullScore", 0);
        ann.getScore = a.optInt("getScore", 0);
        try {
            JSONObject roi = a.getJSONObject("roi");
            ann.roiX = (float) roi.getDouble("x");
            ann.roiY = (float) roi.getDouble("y");
            ann.roiW = (float) roi.getDouble("w");
            ann.roiH = (float) roi.getDouble("h");
        } catch (Exception ignored) {
        }
        return ann;
    }

    @Override
    protected void onMeasure(int widthSpec, int heightSpec) {
        int w = MeasureSpec.getSize(widthSpec);
        if (bitmap != null && w > 0) {
            // 按图片比例确定高度（约 1.414 倍）
            float ratio = (float) bitmap.getHeight() / bitmap.getWidth();
            setMeasuredDimension(w, Math.round(w * Math.min(ratio, 1.8f)));
        } else {
            setMeasuredDimension(w, Math.round(w * 1.414f));
        }
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        if (bitmap != null) {
            scale = Math.min((float) w / bitmap.getWidth(), (float) h / bitmap.getHeight());
            drawW = Math.round(bitmap.getWidth() * scale);
            drawH = Math.round(bitmap.getHeight() * scale);
            offX = (w - drawW) / 2f;
            offY = (h - drawH) / 2f;
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        canvas.drawColor(Color.WHITE);
        if (bitmap != null) {
            Matrix m = new Matrix();
            m.postTranslate(offX, offY);
            m.preScale(scale, scale);
            canvas.drawBitmap(bitmap, m, bmpPaint);
        }

        for (Ann a : anns) {
            float bx = offX + a.roiX * drawW;
            float by = offY + a.roiY * drawH;
            float bw = a.roiW * drawW;
            float bh = a.roiH * drawH;

            // 题框
            canvas.drawRect(bx, by, bx + bw, by + bh, boxPaint);

            // 判分符号（右上角内侧，几何同 PDF）
            float markSize = Math.min(bh, 34f);
            float mx = bx + bw - markSize * 0.7f;
            float my = by + markSize * 0.6f;
            drawJudge(canvas, a.judgeType, mx, my, markSize);

            // 得分标签（左下）
            String score = a.getScore + "/" + a.fullScore;
            textPaint.setTextSize(Math.max(13f, markSize * 0.5f));
            float tw = textPaint.measureText(score);
            float pad = 6f;
            RectF chip = new RectF(bx + 4, by + bh - textPaint.getTextSize() - pad * 2, bx + 4 + tw + pad * 2, by + bh);
            canvas.drawRoundRect(chip, 6f, 6f, chipPaint);
            canvas.drawText(score, chip.left + pad, chip.bottom - pad, textPaint);
        }
    }

    /** 判分符号：correct=√ wrong=× partial=勾+上方叉 */
    private void drawJudge(Canvas canvas, String judge, float cx, float cy, float size) {
        int color;
        if ("correct".equals(judge)) color = 0xFF16A34A;
        else if ("wrong".equals(judge)) color = 0xFFDC2626;
        else color = 0xFFD97706;
        markPaint.setColor(color);

        Path p = new Path();
        if ("correct".equals(judge)) {
            markPaint.setStrokeWidth(size * 0.14f);
            p.moveTo(cx - size * 0.4f, cy);
            p.lineTo(cx - size * 0.08f, cy + size * 0.32f);
            p.lineTo(cx + size * 0.42f, cy - size * 0.34f);
            canvas.drawPath(p, markPaint);
        } else if ("wrong".equals(judge)) {
            markPaint.setStrokeWidth(size * 0.14f);
            p.moveTo(cx - size * 0.35f, cy - size * 0.35f);
            p.lineTo(cx + size * 0.35f, cy + size * 0.35f);
            p.moveTo(cx + size * 0.35f, cy - size * 0.35f);
            p.lineTo(cx - size * 0.35f, cy + size * 0.35f);
            canvas.drawPath(p, markPaint);
        } else {
            // 半对：完整勾 + 勾上方一个叉
            markPaint.setStrokeWidth(size * 0.14f);
            p.moveTo(cx - size * 0.4f, cy);
            p.lineTo(cx - size * 0.08f, cy + size * 0.32f);
            p.lineTo(cx + size * 0.42f, cy - size * 0.34f);
            canvas.drawPath(p, markPaint);

            markPaint.setStrokeWidth(size * 0.11f);
            Path x = new Path();
            float r = size * 0.2f;
            float xc = cx + size * 0.08f;
            float yc = cy - size * 0.26f;
            x.moveTo(xc - r, yc - r);
            x.lineTo(xc + r, yc + r);
            x.moveTo(xc + r, yc - r);
            x.lineTo(xc - r, yc + r);
            canvas.drawPath(x, markPaint);
        }
    }

    /** 点击命中某个题框 → 回调 */
    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (event.getActionMasked() == MotionEvent.ACTION_UP && tapListener != null) {
            float sx = event.getX();
            float sy = event.getY();
            for (int i = anns.size() - 1; i >= 0; i--) {
                Ann a = anns.get(i);
                float bx = offX + a.roiX * drawW;
                float by = offY + a.roiY * drawH;
                float bw = a.roiW * drawW;
                float bh = a.roiH * drawH;
                // 扩大命中区域 16px，方便手指点击
                if (sx >= bx - 16 && sx <= bx + bw + 16 && sy >= by - 16 && sy <= by + bh + 16) {
                    tapListener.onAnnTap(a);
                    return true;
                }
            }
        }
        return true;
    }

    /** 当前视图上的批注（供外部使用） */
    public List<Ann> getAnnotations() {
        return anns;
    }
}
