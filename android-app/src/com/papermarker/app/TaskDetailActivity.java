package com.papermarker.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 任务详情：批注图（原图+题框+判分标记）+ 页切换 + 逐题结果
 * IPP 打印四类 PDF（服务端执行，失败自动降级提示）+ PDF 下载查看
 */
public class TaskDetailActivity extends Activity {

    private String taskId;

    private TextView tvPaperName, tvMeta, tvScore;
    private LinearLayout pageTabs, questionList;
    private MarksView marksView;
    private Button btnPrintMark, btnPrintMarks, btnPrintAnswer, btnPrintParse, btnOpenPdf;

    private JSONObject taskJson;
    private JSONArray pageFiles;   // [{pageNo, fileId, w, h}]
    private JSONArray annotations;
    private int currentPage = 1;
    private final Map<Integer, Bitmap> pageBitmaps = new HashMap<>();
    private final Map<Integer, List<MarksView.Ann>> pageAnns = new HashMap<>();
    private ProgressDialog pd;
    private String currentPdfFileId; // 查看用

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_task_detail);

        taskId = getIntent().getStringExtra("taskId");
        if (taskId == null || taskId.isEmpty()) {
            finish();
            return;
        }

        tvPaperName = findViewById(R.id.tvPaperName);
        tvMeta = findViewById(R.id.tvMeta);
        tvScore = findViewById(R.id.tvScore);
        pageTabs = findViewById(R.id.pageTabs);
        questionList = findViewById(R.id.questionList);
        marksView = findViewById(R.id.marksView);
        btnPrintMark = findViewById(R.id.btnPrintMark);
        btnPrintMarks = findViewById(R.id.btnPrintMarks);
        btnPrintAnswer = findViewById(R.id.btnPrintAnswer);
        btnPrintParse = findViewById(R.id.btnPrintParse);
        btnOpenPdf = findViewById(R.id.btnOpenPdf);

        btnPrintMark.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                doPrint("mark", "批注 PDF");
            }
        });
        btnPrintMarks.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                doPrint("marks", "标记层 PDF");
            }
        });
        btnPrintAnswer.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                doPrint("answer", "答案 PDF");
            }
        });
        btnPrintParse.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                doPrint("parse", "解析 PDF");
            }
        });
        btnOpenPdf.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                choosePdfToOpen();
            }
        });

        marksView.setTapListener(new MarksView.OnAnnTap() {
            @Override
            public void onAnnTap(MarksView.Ann ann) {
                showAnnDialog(ann);
            }
        });

        pd = ProgressDialog.show(this, "", "加载任务…", true, false);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject r = ApiClient.get(TaskDetailActivity.this, "/api/tasks/" + taskId);
                    taskJson = r.getJSONObject("task");
                    pageFiles = taskJson.optJSONArray("pageFiles");
                    annotations = taskJson.optJSONArray("annotations");
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            renderHeader();
                            buildPageTabs();
                            buildQuestionList();
                            loadPage(1);
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissPd();
                            Toast.makeText(TaskDetailActivity.this, "加载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    });
                }
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

    // ---------- 头部信息 ----------

    private void renderHeader() {
        tvPaperName.setText(taskJson.optString("paperName", "未命名试卷"));
        String student = taskJson.optString("studentName", "");
        String date = taskJson.optString("createdAt", "");
        String meta = (student.isEmpty() ? "" : student + " · ") + formatDate(date)
                + " · " + (annotations == null ? 0 : annotations.length()) + " 题";
        tvMeta.setText(meta);
        tvScore.setText("总分 " + taskJson.optInt("totalGet", 0) + " / " + taskJson.optInt("totalFull", 0));
    }

    private String formatDate(String iso) {
        try {
            if (iso == null) return "";
            int dot = iso.indexOf('.');
            if (dot > 0) iso = iso.substring(0, dot);
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.CHINA);
            in.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            Date d = in.parse(iso);
            return new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA).format(d);
        } catch (Exception e) {
            return iso;
        }
    }

    // ---------- 页码切换 ----------

    private void buildPageTabs() {
        pageTabs.removeAllViews();
        int n = pageFiles == null ? 0 : pageFiles.length();
        if (n <= 1) return;
        for (int i = 0; i < n; i++) {
            JSONObject pf = pageFiles.optJSONObject(i);
            if (pf == null) continue;
            final int pageNo = pf.optInt("pageNo", i + 1);
            TextView tab = new TextView(this);
            tab.setText(" 第" + pageNo + "页 ");
            tab.setTextSize(14);
            tab.setPadding(24, 10, 24, 10);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.setMargins(0, 0, 12, 0);
            tab.setLayoutParams(lp);
            tab.setBackgroundResource(pageNo == currentPage ? R.drawable.bg_btn_primary : R.drawable.bg_chip_gray);
            tab.setTextColor(pageNo == currentPage ? Color.WHITE : 0xFF6B7280);
            tab.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    loadPage(pageNo);
                }
            });
            pageTabs.addView(tab);
        }
    }

    /** 加载某页：下载原图 + 组装该页批注 */
    private void loadPage(final int pageNo) {
        currentPage = pageNo;
        buildPageTabs();

        if (pageAnns.containsKey(pageNo) && pageBitmaps.containsKey(pageNo)) {
            marksView.setContent(pageBitmaps.get(pageNo), pageAnns.get(pageNo));
            return;
        }
        // 找 fileId
        String fileId = null;
        if (pageFiles != null) {
            for (int i = 0; i < pageFiles.length(); i++) {
                JSONObject pf = pageFiles.optJSONObject(i);
                if (pf == null) continue;
                if (pf.optInt("pageNo", 1) == pageNo) {
                    fileId = pf.optString("fileId");
                    break;
                }
            }
        }
        if (fileId == null) {
            marksView.setContent(null, new ArrayList<MarksView.Ann>());
            return;
        }

        final String fid = fileId;
        pd = ProgressDialog.show(this, "", "加载第 " + pageNo + " 页…", true, false);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String url = ApiClient.authQuery(TaskDetailActivity.this, "/api/file/" + fid);
                    File tmp = new File(getCacheDir(), "view_" + fid + ".jpg");
                    ApiClient.download(TaskDetailActivity.this, url, tmp);
                    final Bitmap bmp = BitmapUtil.loadDownscaled(tmp.getAbsolutePath(), 1600);

                    final List<MarksView.Ann> anns = new ArrayList<>();
                    if (annotations != null) {
                        for (int i = 0; i < annotations.length(); i++) {
                            JSONObject a = annotations.optJSONObject(i);
                            if (a.optInt("pageNo", 1) == pageNo) anns.add(MarksView.parseAnn(a));
                        }
                    }
                    pageBitmaps.put(pageNo, bmp);
                    pageAnns.put(pageNo, anns);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissPd();
                            marksView.setContent(bmp, anns);
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissPd();
                            Toast.makeText(TaskDetailActivity.this, "页面加载失败：" + e.getMessage(), Toast.LENGTH_SHORT).show();
                        }
                    });
                }
            }
        }).start();
    }

    // ---------- 逐题列表 ----------

    private void buildQuestionList() {
        questionList.removeAllViews();
        if (annotations == null) return;
        LayoutInflater inflater = LayoutInflater.from(this);
        for (int i = 0; i < annotations.length(); i++) {
            final JSONObject a = annotations.optJSONObject(i);
            View v = inflater.inflate(R.layout.item_question, questionList, false);

            TextView tvJudge = v.findViewById(R.id.tvJudge);
            TextView tvQuestion = v.findViewById(R.id.tvQuestion);
            TextView tvScoreQ = v.findViewById(R.id.tvScore);
            TextView tvReason = v.findViewById(R.id.tvReason);

            String judge = a.optString("judgeType", "correct");
            String judgeLabel;
            int judgeColor;
            if ("correct".equals(judge)) {
                judgeLabel = "√ 对";
                judgeColor = 0xFF16A34A;
            } else if ("wrong".equals(judge)) {
                judgeLabel = "× 错";
                judgeColor = 0xFFDC2626;
            } else {
                judgeLabel = "√× 半对";
                judgeColor = 0xFFD97706;
            }
            tvJudge.setText(judgeLabel);
            tvJudge.setTextColor(judgeColor);
            tvQuestion.setText((i + 1) + ". " + a.optString("questionText", ""));
            tvScoreQ.setText(a.optInt("getScore", 0) + "/" + a.optInt("fullScore", 0));
            String reason = a.optString("briefReason", "");
            if (reason != null && !reason.isEmpty() && !"null".equals(reason)) {
                tvReason.setText("点评：" + reason);
                tvReason.setVisibility(View.VISIBLE);
            }

            v.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showAnnDialog(MarksView.parseAnn(a));
                }
            });
            questionList.addView(v);
        }
    }

    private void showAnnDialog(MarksView.Ann ann) {
        StringBuilder sb = new StringBuilder();
        sb.append("题干：").append(ann.questionText).append("\n\n");
        sb.append("判定：");
        if ("correct".equals(ann.judgeType)) sb.append("√ 正确");
        else if ("wrong".equals(ann.judgeType)) sb.append("× 错误");
        else sb.append("√× 半对");
        sb.append("（").append(ann.getScore).append("/").append(ann.fullScore).append(" 分）\n\n");
        if (notNull(ann.briefReason)) sb.append("点评：").append(ann.briefReason).append("\n\n");
        if (notNull(ann.answerText)) sb.append("标准答案：").append(ann.answerText).append("\n\n");
        if (notNull(ann.fullSolution)) sb.append("解析：").append(ann.fullSolution);
        new AlertDialog.Builder(this)
                .setTitle("题目详情")
                .setMessage(sb.toString())
                .setPositiveButton("知道了", null)
                .show();
    }

    private boolean notNull(String s) {
        return s != null && !s.isEmpty() && !"null".equals(s);
    }

    // ---------- IPP 打印 ----------

    private void doPrint(final String subType, final String label) {
        pd = ProgressDialog.show(this, "", "正在下发 " + label + " 至打印机…", true, false);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject body = new JSONObject();
                    body.put("taskId", taskId);
                    body.put("subType", subType);
                    body.put("duplex", false);
                    body.put("copies", 1);
                    final JSONObject r = ApiClient.post(TaskDetailActivity.this, "/api/print", body);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissPd();
                            if (r.optInt("code", 0) == 200) {
                                String msg = r.optString("msg", "已发送");
                                Toast.makeText(TaskDetailActivity.this, label + "：" + msg, Toast.LENGTH_LONG).show();
                            } else {
                                // IPP 失败：服务端返回 fallbackPdfFileId，下载后可直接打开
                                final String fb = r.optString("fallbackPdfFileId", "");
                                String msg = r.optString("msg", "打印失败");
                                if (!fb.isEmpty()) {
                                    new AlertDialog.Builder(TaskDetailActivity.this)
                                            .setTitle("IPP 打印失败")
                                            .setMessage(msg + "\n\n是否改为下载 PDF 用手机打印服务打开？")
                                            .setPositiveButton("下载 PDF", new DialogInterface.OnClickListener() {
                                                @Override
                                                public void onClick(DialogInterface d, int w) {
                                                    openPdfFile(fb);
                                                }
                                            })
                                            .setNegativeButton("取消", null)
                                            .show();
                                } else {
                                    Toast.makeText(TaskDetailActivity.this, "打印失败：" + msg, Toast.LENGTH_LONG).show();
                                }
                            }
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissPd();
                            Toast.makeText(TaskDetailActivity.this, "打印请求失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    });
                }
            }
        }).start();
    }

    // ---------- PDF 查看 / 导出 ----------

    private void choosePdfToOpen() {
        if (taskJson == null) return;
        final String[] labels = {"批注 PDF（原图+标记）", "纯标记层（仅√×标记）", "答案 PDF", "解析 PDF"};
        final String[] fileIds = {
                taskJson.optString("markPdfFileId", ""),
                taskJson.optString("marksPdfFileId", ""),
                taskJson.optString("answerPdfFileId", ""),
                taskJson.optString("parsePdfFileId", "")
        };
        new AlertDialog.Builder(this)
                .setTitle("选择要查看的 PDF")
                .setItems(labels, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        String fid = fileIds[which];
                        if (fid == null || fid.isEmpty()) {
                            Toast.makeText(TaskDetailActivity.this, "该 PDF 尚未生成", Toast.LENGTH_SHORT).show();
                            return;
                        }
                        openPdfFile(fid);
                    }
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void openPdfFile(final String fileId) {
        currentPdfFileId = fileId;
        pd = ProgressDialog.show(this, "", "下载 PDF…", true, false);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String url = ApiClient.authQuery(TaskDetailActivity.this, "/api/file/" + fileId);
                    File dest = new File(getCacheDir(), "doc_" + fileId + ".pdf");
                    ApiClient.download(TaskDetailActivity.this, url, dest);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissPd();
                            Uri uri = Uri.parse("content://com.papermarker.app.cache/" + dest.getName());
                            Intent it = new Intent(Intent.ACTION_VIEW);
                            it.setDataAndType(uri, "application/pdf");
                            it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            try {
                                startActivity(it);
                            } catch (Exception e) {
                                Toast.makeText(TaskDetailActivity.this,
                                        "手机上暂无 PDF 查看器，PDF 已缓存：" + dest.getName(), Toast.LENGTH_LONG).show();
                            }
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            dismissPd();
                            Toast.makeText(TaskDetailActivity.this, "下载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
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
