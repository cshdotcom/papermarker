package com.papermarker.app;

import android.app.Activity;
import android.app.ProgressDialog;
import android.graphics.Bitmap;
import android.graphics.PointF;
import android.os.Bundle;
import android.view.View;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;

/**
 * 裁切页：自动边缘检测 → 四角拖动微调 → 旋转 → 黑白增强 → 透视矫正输出
 */
public class CropActivity extends Activity {

    private CropView cropView;
    private TextView btnDetect, btnBw, btnConfirm, btnCancel;
    private Bitmap bitmap;
    private boolean bwMode = false;
    private String inputPath;
    private ProgressDialog pd;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_crop);

        inputPath = getIntent().getStringExtra("input_path");
        cropView = findViewById(R.id.cropView);
        btnDetect = findViewById(R.id.btnDetect);
        btnBw = findViewById(R.id.btnBw);
        btnConfirm = findViewById(R.id.btnConfirm);
        btnCancel = findViewById(R.id.btnCancel);

        btnCancel.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new File(inputPath).delete();
                setResult(RESULT_CANCELED);
                finish();
            }
        });

        btnDetect.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                runDetect(true);
            }
        });

        btnBw.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                bwMode = !bwMode;
                btnBw.setText(bwMode ? "黑白 开" : "黑白增强");
                cropView.invalidate();
            }
        });

        btnConfirm.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                confirm();
            }
        });

        findViewById(R.id.btnRotate).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                rotate();
            }
        });

        // 载入 + 自动检测
        pd = ProgressDialog.show(this, "", "处理中…", true, false);
        new Thread(new Runnable() {
            @Override
            public void run() {
                final Bitmap bmp = BitmapUtil.loadDownscaled(inputPath, 1800);
                if (bmp == null) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissPd();
                            Toast.makeText(CropActivity.this, "图片读取失败", Toast.LENGTH_SHORT).show();
                            setResult(RESULT_CANCELED);
                            finish();
                        }
                    });
                    return;
                }
                bitmap = bmp;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        cropView.setBitmap(bitmap, null);
                        runDetect(false);
                    }
                });
            }
        }).start();
    }

    private void dismissPd() {
        if (pd != null && pd.isShowing()) {
            try {
                pd.dismiss();
            } catch (Throwable ignored) {
            }
        }
    }

    /** 边缘检测（后台线程），showToast 表示手动触发 */
    private void runDetect(final boolean manual) {
        if (bitmap == null) return;
        if (!manual) dismissPd();
        if (manual) {
            pd = ProgressDialog.show(this, "", "检测纸张边缘…", true, false);
        }
        final Bitmap b = bitmap;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final PointF[] pts = DocDetector.detect(b);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        dismissPd();
                        if (pts != null) {
                            cropView.setCorners(pts);
                            if (manual) Toast.makeText(CropActivity.this, "已自动识别纸张边缘，可微调四角", Toast.LENGTH_SHORT).show();
                        } else {
                            if (manual)
                                Toast.makeText(CropActivity.this, "未检测到明显纸张边缘，请手动拖动四角", Toast.LENGTH_SHORT).show();
                        }
                    }
                });
            }
        }).start();
    }

    /** 旋转 90°：位图 + 四角坐标同步变换 */
    private void rotate() {
        if (bitmap == null) return;
        PointF[] old = cropView.getCorners();
        int oldW = bitmap.getWidth(), oldH = bitmap.getHeight();
        Bitmap rotated = BitmapUtil.rotate90(bitmap);
        if (rotated == null) return;
        bitmap.recycle();
        bitmap = rotated;
        PointF[] newPts = new PointF[4];
        for (int i = 0; i < 4; i++) newPts[i] = BitmapUtil.rotatePoint(old[i], oldW, oldH);
        cropView.setBitmap(bitmap, newPts);
    }

    /** 确认：透视矫正 → 保存 → 返回 */
    private void confirm() {
        if (bitmap == null) return;
        btnConfirm.setEnabled(false);
        btnConfirm.setText("矫正中…");
        final PointF[] corners = cropView.getCorners();
        final boolean bw = bwMode;
        final Bitmap src = bitmap;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Bitmap out = BitmapUtil.warp(src, corners, bw);
                    if (out == null) throw new Exception("裁切区域太小");
                    File dest = new File(getCacheDir(), "page_" + System.currentTimeMillis() + ".jpg");
                    BitmapUtil.saveJpeg(out, dest, 90);
                    out.recycle();
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            android.content.Intent it = new android.content.Intent();
                            it.putExtra("output_path", dest.getAbsolutePath());
                            setResult(RESULT_OK, it);
                            // 原始拍摄文件已消费，清理
                            new File(inputPath).delete();
                            finish();
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            btnConfirm.setEnabled(true);
                            btnConfirm.setText("确认本页");
                            Toast.makeText(CropActivity.this, "失败：" + e.getMessage(), Toast.LENGTH_SHORT).show();
                        }
                    });
                }
            }
        }).start();
    }

    @Override
    protected void onDestroy() {
        dismissPd();
        super.onDestroy();
    }
}
