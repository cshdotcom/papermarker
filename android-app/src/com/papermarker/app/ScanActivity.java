package com.papermarker.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ClipData;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.ImageFormat;
import android.graphics.SurfaceTexture;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Size;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 扫描页：Camera2 实时预览 + 拍照 + 相册导入
 * 每页经 CropActivity（边缘检测 + 透视矫正）后加入页面列表
 * 一次 multipart 请求把全部页面上传服务端 → AI 批改 → 跳转详情
 */
public class ScanActivity extends Activity {

    private static final int REQ_CROP = 2001;
    private static final int REQ_GALLERY = 2002;
    private static final int REQ_PERM = 3001;

    // ---------- 相机 ----------
    private AutoFitTextureView textureView;
    private CameraDevice camera;
    private CameraCaptureSession session;
    private CaptureRequest.Builder previewBuilder;
    private ImageReader imageReader;
    private Size previewSize;
    private int sensorOrientation = 90;
    private String cameraId;
    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private boolean torchOn = false;
    private boolean cameraReady = false;
    private boolean capturing = false;
    /** 拍照序号：保存成功/失败时自增，作废未触发的 2 秒兜底超时 */
    private int captureSeq = 0;
    /** 快速连拍模式：拍完不进裁切，直接整张入页列表 */
    private boolean burstMode = false;

    // ---------- 页面数据 ----------
    private final ArrayList<String> pages = new ArrayList<>();       // 已矫正页面路径
    private final ArrayList<String> pendingCrop = new ArrayList<>(); // 相册导入待裁切队列
    private LinearLayout thumbs;
    private TextView tvPageCount, btnTorch, btnBurst, btnGallery, btnUpload;
    private View btnShutter;
    private EditText etPaperName, etStudent;
    private ProgressDialog progressDialog;

    private final TextureView.SurfaceTextureListener surfaceListener = new TextureView.SurfaceTextureListener() {
        @Override
        public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
            openCamera();
        }

        @Override
        public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
        }

        @Override
        public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
            return true;
        }

        @Override
        public void onSurfaceTextureUpdated(SurfaceTexture surface) {
        }
    };

    private final CameraDevice.StateCallback cameraStateCallback = new CameraDevice.StateCallback() {
        @Override
        public void onOpened(CameraDevice cam) {
            camera = cam;
            createSession();
        }

        @Override
        public void onDisconnected(CameraDevice cam) {
            cam.close();
            camera = null;
            cameraReady = false;
        }

        @Override
        public void onError(CameraDevice cam, int error) {
            cam.close();
            camera = null;
            cameraReady = false;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(ScanActivity.this, "相机打开失败（" + error + "），可用「相册」导入照片", Toast.LENGTH_LONG).show();
                }
            });
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_scan);

        textureView = findViewById(R.id.preview);
        thumbs = findViewById(R.id.thumbs);
        tvPageCount = findViewById(R.id.tvPageCount);
        btnTorch = findViewById(R.id.btnTorch);
        btnBurst = findViewById(R.id.btnBurst);
        btnGallery = findViewById(R.id.btnGallery);
        btnUpload = findViewById(R.id.btnUpload);
        btnShutter = findViewById(R.id.btnShutter);
        etPaperName = findViewById(R.id.etPaperName);
        etStudent = findViewById(R.id.etStudent);

        String name = "扫描试卷-" + new SimpleDateFormat("MM月dd日-HHmm", Locale.CHINA).format(new Date());
        etPaperName.setText(name);

        btnShutter.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                takePicture();
            }
        });
        btnTorch.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggleTorch();
            }
        });
        btnBurst.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggleBurst();
            }
        });
        btnGallery.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pickFromGallery();
            }
        });
        btnUpload.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (pages.isEmpty()) {
                    Toast.makeText(ScanActivity.this, "请先扫描至少一页", Toast.LENGTH_SHORT).show();
                    return;
                }
                upload();
            }
        });

        refreshUi();
    }

    @Override
    protected void onResume() {
        super.onResume();
        startCameraThread();
        if (textureView.isAvailable()) {
            openCamera();
        } else {
            textureView.setSurfaceTextureListener(surfaceListener);
        }
    }

    @Override
    protected void onPause() {
        closeCamera();
        stopCameraThread();
        super.onPause();
    }

    // ---------- 权限 ----------

    private boolean hasCameraPermission() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestCameraPermission() {
        requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_PERM);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERM) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                openCamera();
            } else {
                Toast.makeText(this, "未授予相机权限，仍可从相册导入扫描", Toast.LENGTH_LONG).show();
            }
        }
    }

    // ---------- 相机线程 ----------

    private void startCameraThread() {
        if (cameraThread == null) {
            cameraThread = new HandlerThread("CameraThread");
            cameraThread.start();
            cameraHandler = new Handler(cameraThread.getLooper());
        }
    }

    private void stopCameraThread() {
        if (cameraThread != null) {
            cameraThread.quitSafely();
            try {
                cameraThread.join();
            } catch (InterruptedException ignored) {
            }
            cameraThread = null;
            cameraHandler = null;
        }
    }

    // ---------- 打开相机 ----------

    private void openCamera() {
        if (cameraReady || isFinishing()) return;
        if (!hasCameraPermission()) {
            requestCameraPermission();
            return;
        }
        try {
            CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics ch = manager.getCameraCharacteristics(id);
                Integer facing = ch.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    cameraId = id;
                    sensorOrientation = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) != null
                            ? ch.get(CameraCharacteristics.SENSOR_ORIENTATION) : 90;
                    StreamConfigurationMap map = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                    if (map == null) continue;

                    previewSize = chooseSize(map.getOutputSizes(SurfaceTexture.class), 1600);
                    Size captureSize = chooseSize(map.getOutputSizes(ImageFormat.JPEG), 2600);
                    imageReader = ImageReader.newInstance(captureSize.getWidth(), captureSize.getHeight(), ImageFormat.JPEG, 2);
                    imageReader.setOnImageAvailableListener(new ImageReader.OnImageAvailableListener() {
                        @Override
                        public void onImageAvailable(ImageReader reader) {
                            saveCapture(reader);
                        }
                    }, cameraHandler);

                    // 竖屏显示：比例取预览尺寸的转置（传感器横向输出 → 竖向展示）
                    if (previewSize != null) {
                        textureView.setAspectRatio(previewSize.getHeight(), previewSize.getWidth());
                    }

                    try {
                        manager.openCamera(cameraId, cameraStateCallback, cameraHandler);
                    } catch (SecurityException se) {
                        requestCameraPermission();
                    }
                    return;
                }
            }
            Toast.makeText(this, "未找到后置摄像头，可从相册导入", Toast.LENGTH_LONG).show();
        } catch (Throwable t) {
            Toast.makeText(this, "相机初始化失败：" + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /** 选尺寸：限制上界内面积最大 */
    private Size chooseSize(Size[] sizes, int cap) {
        if (sizes == null || sizes.length == 0) return new Size(1280, 720);
        Size best = null;
        for (Size s : sizes) {
            if (s.getWidth() > cap || s.getHeight() > cap) continue;
            if (best == null || s.getWidth() * (long) s.getHeight() > best.getWidth() * (long) best.getHeight()) {
                best = s;
            }
        }
        return best != null ? best : sizes[0];
    }

    private void createSession() {
        try {
            SurfaceTexture texture = textureView.getSurfaceTexture();
            if (texture == null) return;
            texture.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
            Surface surface = new Surface(texture);

            previewBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            previewBuilder.addTarget(surface);
            previewBuilder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);

            camera.createCaptureSession(Arrays.asList(surface, imageReader.getSurface()),
                    new CameraCaptureSession.StateCallback() {
                        @Override
                        public void onConfigured(CameraCaptureSession s) {
                            session = s;
                            cameraReady = true;
                            applyTorch();
                        }

                        @Override
                        public void onConfigureFailed(CameraCaptureSession s) {
                            cameraReady = false;
                        }
                    }, cameraHandler);
        } catch (Throwable t) {
            // 相机会话失败：不影响相册流程
        }
    }

    private void applyTorch() {
        if (!cameraReady || previewBuilder == null) return;
        try {
            previewBuilder.set(CaptureRequest.FLASH_MODE,
                    torchOn ? CaptureRequest.FLASH_MODE_TORCH : CaptureRequest.FLASH_MODE_OFF);
            session.setRepeatingRequest(previewBuilder.build(), null, cameraHandler);
        } catch (Throwable ignored) {
        }
    }

    private void toggleTorch() {
        torchOn = !torchOn;
        btnTorch.setText(torchOn ? "闪光 开" : "闪光");
        applyTorch();
    }

    /** 快速连拍开关：开启后拍照不入裁切，直接整张加入页面列表 */
    private void toggleBurst() {
        burstMode = !burstMode;
        btnBurst.setText(burstMode ? "连拍 开" : "连拍 关");
        Toast.makeText(this, burstMode ? "连拍已开启：拍照直接加入页面列表"
                        : "连拍已关闭：拍照后进入边缘矫正", Toast.LENGTH_SHORT).show();
    }

    private void closeCamera() {
        cameraReady = false;
        try {
            if (session != null) {
                session.close();
                session = null;
            }
        } catch (Throwable ignored) {
        }
        try {
            if (camera != null) {
                camera.close();
                camera = null;
            }
        } catch (Throwable ignored) {
        }
        if (imageReader != null) {
            imageReader.close();
            imageReader = null;
        }
    }

    // ---------- 拍照 ----------

    private void takePicture() {
        if (capturing) return;
        if (!cameraReady || camera == null || session == null) {
            Toast.makeText(this, "相机未就绪，可从相册导入", Toast.LENGTH_SHORT).show();
            return;
        }
        capturing = true;
        try {
            final CaptureRequest.Builder cb = camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE);
            cb.addTarget(imageReader.getSurface());
            cb.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);
            if (torchOn) cb.set(CaptureRequest.FLASH_MODE, CaptureRequest.FLASH_MODE_SINGLE);
            // 竖屏锁定：JPEG 旋转 = 传感器方向
            cb.set(CaptureRequest.JPEG_ORIENTATION, sensorOrientation);
            session.stopRepeating();
            session.capture(cb.build(), null, cameraHandler);
            // 2 秒兜底：ImageReader 回调未到（拍照失败）时恢复可拍，避免 capturing 永久卡死；
            // 保存成功/失败时会自增 captureSeq 作废本次超时
            final int seq = ++captureSeq;
            cameraHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            if (seq == captureSeq) capturing = false;
                        }
                    });
                }
            }, 2000);
            // 恢复预览
            cameraHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    applyTorch();
                }
            }, 400);
        } catch (Throwable t) {
            capturing = false;
            Toast.makeText(this, "拍照失败：" + t.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    /** ImageReader 回调（相机线程）：JPEG 字节 → 临时文件 → 裁切或连拍入列 */
    private void saveCapture(ImageReader reader) {
        try {
            Image image = reader.acquireLatestImage();
            if (image == null) return;
            ByteBuffer buf = image.getPlanes()[0].getBuffer();
            byte[] bytes = new byte[buf.remaining()];
            buf.get(bytes);
            image.close();

            File f = new File(getCacheDir(), "shot_" + System.currentTimeMillis() + ".jpg");
            FileOutputStream fos = new FileOutputStream(f);
            fos.write(bytes);
            fos.flush();
            fos.close();

            final String path = f.getAbsolutePath();
            if (burstMode) {
                // 连拍模式：相机线程内串行压缩（保证页序），不入裁切直接加入列表
                final String out = compressForBurst(path);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        captureSeq++; // 已保存，作废兜底超时
                        capturing = false;
                        if (out != null) {
                            pages.add(out);
                            refreshUi();
                            Toast.makeText(ScanActivity.this,
                                    "已加入第 " + pages.size() + " 页（连拍模式）", Toast.LENGTH_SHORT).show();
                        }
                    }
                });
            } else {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        captureSeq++; // 已保存，作废兜底超时
                        capturing = false;
                        launchCrop(path);
                    }
                });
            }
        } catch (final Throwable t) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    captureSeq++; // 已失败，作废兜底超时
                    capturing = false;
                    Toast.makeText(ScanActivity.this, "保存照片失败：" + t.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }
    }

    /**
     * 连拍模式：整张照片压缩到 1800 宽后存 cache（fast_时间戳.jpg），避免超大 JPEG 上传慢。
     * 在相机线程调用（串行保证页序）；失败返回 null 并清理临时文件。
     */
    private String compressForBurst(final String shotPath) {
        try {
            Bitmap b = BitmapUtil.loadDownscaled(shotPath, 1800);
            if (b == null) throw new Exception("图片解码失败");
            File dest = new File(getCacheDir(), "fast_" + System.currentTimeMillis() + ".jpg");
            BitmapUtil.saveJpeg(b, dest, 90);
            b.recycle();
            new File(shotPath).delete(); // 原始拍摄文件已消费，清理
            return dest.getAbsolutePath();
        } catch (final Throwable t) {
            new File(shotPath).delete();
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(ScanActivity.this, "连拍保存失败：" + t.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
            return null;
        }
    }

    private void launchCrop(String path) {
        Intent it = new Intent(this, CropActivity.class);
        it.putExtra("input_path", path);
        startActivityForResult(it, REQ_CROP);
    }

    // ---------- 相册导入（多选） ----------

    private void pickFromGallery() {
        Intent it = new Intent(Intent.ACTION_GET_CONTENT);
        it.setType("image/*");
        it.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(Intent.createChooser(it, "选择试卷照片（可多选）"), REQ_GALLERY);
    }

    // ---------- 裁切结果 / 相册结果 ----------

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_GALLERY && resultCode == RESULT_OK && data != null) {
            pendingCrop.clear();
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    String p = copyUriToCache(clip.getItemAt(i).getUri(), i);
                    if (p != null) pendingCrop.add(p);
                }
            } else if (data.getData() != null) {
                String p = copyUriToCache(data.getData(), 0);
                if (p != null) pendingCrop.add(p);
            }
            if (!pendingCrop.isEmpty()) {
                launchCrop(pendingCrop.remove(0));
            }
            return;
        }

        if (requestCode == REQ_CROP) {
            if (resultCode == RESULT_OK && data != null) {
                String out = data.getStringExtra("output_path");
                if (out != null) {
                    pages.add(out);
                    refreshUi();
                }
            }
            // 相册队列中还有待裁切页
            if (!pendingCrop.isEmpty()) {
                launchCrop(pendingCrop.remove(0));
            }
        }
    }

    private String copyUriToCache(android.net.Uri uri, int index) {
        try {
            File f = new File(getCacheDir(), "gal_" + System.currentTimeMillis() + "_" + index + ".jpg");
            java.io.InputStream in = getContentResolver().openInputStream(uri);
            FileOutputStream fos = new FileOutputStream(f);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
            in.close();
            fos.close();
            return f.getAbsolutePath();
        } catch (Exception e) {
            Toast.makeText(this, "读取相册图片失败：" + e.getMessage(), Toast.LENGTH_SHORT).show();
            return null;
        }
    }

    // ---------- 缩略图 / 页计数 ----------

    private void refreshUi() {
        tvPageCount.setText("已采集 " + pages.size() + " 页");
        thumbs.removeAllViews();
        for (int i = 0; i < pages.size(); i++) {
            final int idx = i;
            String path = pages.get(i);

            LinearLayout cell = new LinearLayout(this);
            cell.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.setMargins(4, 4, 4, 4);
            cell.setLayoutParams(lp);

            ImageView iv = new ImageView(this);
            Bitmap t = BitmapUtil.thumbnail(path, 160);
            if (t != null) iv.setImageBitmap(t);
            iv.setScaleType(ImageView.ScaleType.FIT_CENTER);
            int size = (int) (72 * getResources().getDisplayMetrics().density);
            LinearLayout.LayoutParams ivLp = new LinearLayout.LayoutParams(size, size);
            iv.setLayoutParams(ivLp);
            iv.setBackgroundResource(R.drawable.bg_btn_outline);
            cell.addView(iv);

            TextView num = new TextView(this);
            num.setText("第" + (i + 1) + "页");
            num.setTextColor(0xFFFFFFFF);
            num.setTextSize(10);
            num.setGravity(android.view.Gravity.CENTER);
            cell.addView(num);

            // 点击 / 长按删除
            cell.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    confirmDeletePage(idx);
                }
            });
            cell.setOnLongClickListener(new View.OnLongClickListener() {
                @Override
                public boolean onLongClick(View v) {
                    confirmDeletePage(idx);
                    return true;
                }
            });
            thumbs.addView(cell);
        }
    }

    private void confirmDeletePage(final int idx) {
        new AlertDialog.Builder(ScanActivity.this)
                .setTitle("删除本页")
                .setMessage("确定删除第 " + (idx + 1) + " 页？")
                .setPositiveButton("删除", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        new File(pages.get(idx)).delete();
                        pages.remove(idx);
                        refreshUi();
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    // ---------- 上传 ----------

    private void upload() {
        final String paperName = etPaperName.getText().toString().trim();
        final String student = etStudent.getText().toString().trim();
        if (paperName.isEmpty()) {
            Toast.makeText(this, "请填写试卷名称", Toast.LENGTH_SHORT).show();
            return;
        }

        progressDialog = new ProgressDialog(this);
        progressDialog.setMessage("准备上传…");
        progressDialog.setCancelable(false);
        progressDialog.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        progressDialog.setMax(100);
        progressDialog.show();

        final List<String> toUpload = new ArrayList<>(pages);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject r = ApiClient.uploadPages(ScanActivity.this, toUpload, paperName, student,
                            new ApiClient.ProgressListener() {
                                @Override
                                public void onProgress(final long sent, final long total) {
                                    runOnUiThread(new Runnable() {
                                        @Override
                                        public void run() {
                                            if (progressDialog != null && !progressDialog.isShowing()) return;
                                            int pct = (int) (sent * 100 / Math.max(1, total));
                                            progressDialog.setMessage("上传中 " + pct + "%");
                                            progressDialog.setProgress(pct);
                                        }
                                    });
                                }
                            });
                    final String taskId = r.optString("taskId", "");
                    JSONObject s = r.optJSONObject("summary");
                    if (s == null) s = new JSONObject();
                    final JSONObject sm = s;
                    final String summary = "AI 批改完成："
                            + sm.optInt("questionCount", 0) + " 题，得分 "
                            + sm.optInt("totalGet", 0) + "/"
                            + sm.optInt("totalFull", 0);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissProgress();
                            Toast.makeText(ScanActivity.this, summary, Toast.LENGTH_LONG).show();
                            // 清理本地临时页
                            for (String p : toUpload) new File(p).delete();
                            Intent it = new Intent(ScanActivity.this, TaskDetailActivity.class);
                            it.putExtra("taskId", taskId);
                            startActivity(it);
                            setResult(RESULT_OK);
                            finish();
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissProgress();
                            new AlertDialog.Builder(ScanActivity.this)
                                    .setTitle("上传失败")
                                    .setMessage(e.getMessage())
                                    .setPositiveButton("重试", new DialogInterface.OnClickListener() {
                                        @Override
                                        public void onClick(DialogInterface d, int w) {
                                            upload();
                                        }
                                    })
                                    .setNegativeButton("取消", null)
                                    .show();
                        }
                    });
                }
            }
        }).start();
    }

    private void dismissProgress() {
        if (progressDialog != null && progressDialog.isShowing()) {
            try {
                progressDialog.dismiss();
            } catch (Throwable ignored) {
            }
        }
    }
}
