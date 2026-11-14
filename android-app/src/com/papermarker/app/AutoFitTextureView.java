package com.papermarker.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.TextureView;

/**
 * 依据预览尺寸自适应宽高比的 TextureView
 * （竖屏相机预览：把横向的传感器输出尺寸交换后作为显示比例）
 */
public class AutoFitTextureView extends TextureView {

    private int mRatioWidth = 0;
    private int mRatioHeight = 0;

    public AutoFitTextureView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    /** 设置宽高比（w/h），触发重新测量 */
    public void setAspectRatio(int width, int height) {
        if (width < 0 || height < 0) throw new IllegalArgumentException("Size cannot be negative.");
        mRatioWidth = width;
        mRatioHeight = height;
        requestLayout();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        super.onMeasure(widthMeasureSpec, heightMeasureSpec);
        int width = MeasureSpec.getSize(widthMeasureSpec);
        int height = MeasureSpec.getSize(heightMeasureSpec);
        if (mRatioWidth == 0 || mRatioHeight == 0) {
            setMeasuredDimension(width, height);
        } else {
            if (width < (height * mRatioWidth / mRatioHeight)) {
                setMeasuredDimension(width, width * mRatioHeight / mRatioWidth);
            } else {
                setMeasuredDimension(height * mRatioWidth / mRatioHeight, height);
            }
        }
    }
}
