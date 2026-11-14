package com.papermarker.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** 主页：任务列表 + 扫描入口 + 设置 */
public class MainActivity extends Activity {

    private static final int REQ_SCAN = 1001;

    private TextView tvUser, tvEmpty;
    private ListView list;
    private TaskAdapter adapter;
    private final List<JSONObject> tasks = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        if (Prefs.getToken(this).isEmpty() || Prefs.getBase(this).isEmpty()) {
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }

        tvUser = findViewById(R.id.tvUser);
        tvEmpty = findViewById(R.id.tvEmpty);
        list = findViewById(R.id.listTasks);
        adapter = new TaskAdapter();
        list.setAdapter(adapter);

        tvUser.setText(Prefs.getUsername(this) + " @ " + Prefs.getBase(this));

        Button btnScan = findViewById(R.id.btnScan);
        Button btnRefresh = findViewById(R.id.btnRefresh);
        TextView btnSettings = findViewById(R.id.btnSettings);

        btnScan.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivityForResult(new Intent(MainActivity.this, ScanActivity.class), REQ_SCAN);
            }
        });
        btnRefresh.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                loadTasks();
            }
        });
        btnSettings.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("设置")
                        .setMessage("当前服务端：" + Prefs.getBase(MainActivity.this)
                                + "\n账号：" + Prefs.getUsername(MainActivity.this))
                        .setPositiveButton("退出登录", new DialogInterface.OnClickListener() {
                            @Override
                            public void onClick(DialogInterface d, int w) {
                                Prefs.clearLogin(MainActivity.this);
                                startActivity(new Intent(MainActivity.this, LoginActivity.class));
                                finish();
                            }
                        })
                        .setNegativeButton("取消", null)
                        .show();
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (Prefs.getToken(this).isEmpty()) {
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }
        loadTasks();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SCAN) loadTasks();
    }

    private void loadTasks() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject r = ApiClient.get(MainActivity.this, "/api/tasks");
                    final JSONArray arr = r.optJSONArray("tasks");
                    final List<JSONObject> fresh = new ArrayList<>();
                    if (arr != null) {
                        for (int i = 0; i < arr.length(); i++) fresh.add(arr.getJSONObject(i));
                    }
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            tasks.clear();
                            tasks.addAll(fresh);
                            adapter.notifyDataSetChanged();
                            list.setVisibility(fresh.isEmpty() ? View.GONE : View.VISIBLE);
                            tvEmpty.setVisibility(fresh.isEmpty() ? View.VISIBLE : View.GONE);
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(MainActivity.this, "加载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
                        }
                    });
                }
            }
        }).start();
    }

    // ---------- 任务列表适配器 ----------

    private class TaskAdapter extends BaseAdapter {

        private final LayoutInflater inflater = LayoutInflater.from(MainActivity.this);

        @Override
        public int getCount() {
            return tasks.size();
        }

        @Override
        public Object getItem(int position) {
            return tasks.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View v = convertView;
            if (v == null) v = inflater.inflate(R.layout.item_task, parent, false);

            JSONObject t = tasks.get(position);
            TextView tvPaper = v.findViewById(R.id.tvPaper);
            TextView tvScore = v.findViewById(R.id.tvScore);
            TextView tvSub = v.findViewById(R.id.tvSub);
            TextView tvStatus = v.findViewById(R.id.tvStatus);

            tvPaper.setText(t.optString("paperName", "未命名试卷"));
            tvScore.setText(t.optInt("totalGet", 0) + "/" + t.optInt("totalFull", 0));

            String student = t.optString("studentName", "");
            String date = formatDate(t.optString("createdAt", ""));
            String sub = (student.isEmpty() ? "" : student + " · ") + date
                    + " · " + t.optInt("annotationCount", 0) + " 题";
            tvSub.setText(sub);

            String review = t.optString("reviewStatus", "");
            String print = t.optString("printStatus", "");
            String reviewLabel;
            if ("pending_ai".equals(review)) reviewLabel = "AI 批改中";
            else if ("pending_review".equals(review)) reviewLabel = "待复核";
            else if ("reviewed".equals(review)) reviewLabel = "已复核";
            else reviewLabel = review;
            if ("print_finish".equals(print)) reviewLabel += " · 已打印";
            else if ("print_failed".equals(print)) reviewLabel += " · 打印失败";
            tvStatus.setText(reviewLabel);

            v.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Intent it = new Intent(MainActivity.this, TaskDetailActivity.class);
                    it.putExtra("taskId", t.optString("id"));
                    startActivity(it);
                }
            });
            return v;
        }
    }

    private String formatDate(String iso) {
        try {
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.CHINA);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = in.parse(isaSafe(iso));
            SimpleDateFormat out = new SimpleDateFormat("MM-dd HH:mm", Locale.CHINA);
            return out.format(d);
        } catch (Exception e) {
            return iso;
        }
    }

    private String isaSafe(String iso) {
        if (iso == null) return "";
        // 截掉毫秒与时区（如 .123Z）
        int dot = iso.indexOf('.');
        if (dot > 0) return iso.substring(0, dot);
        return iso;
    }
}
