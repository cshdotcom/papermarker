package com.papermarker.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 登录：连接服务端（HTTP 直连），两种方式：
 *  1. 账号密码 → JWT Token（Bearer）
 *  2. API Key 应用连接（在网站「设置 → 应用连接」中创建，X-API-Key 直连）
 */
public class LoginActivity extends Activity {

    private EditText etServer, etUser, etPass, etKey;
    private Button btnLogin, btnMode;
    private TextView tvStatus;
    /** true = API Key 模式 */
    private boolean keyMode = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        etServer = findViewById(R.id.etServer);
        etUser = findViewById(R.id.etUser);
        etPass = findViewById(R.id.etPass);
        etKey = findViewById(R.id.etKey);
        btnLogin = findViewById(R.id.btnLogin);
        btnMode = findViewById(R.id.btnMode);
        tvStatus = findViewById(R.id.tvStatus);

        // 回填上次输入
        String base = Prefs.getBase(this);
        if (base.isEmpty()) {
            etServer.setText("http://192.168.1.100:3000");
            etServer.setSelection(etServer.getText().length());
        } else {
            etServer.setText(base);
        }
        String user = Prefs.getUsername(this);
        etUser.setText(user.isEmpty() ? "teacher" : user);
        etPass.setText("papermarker");
        etKey.setText(Prefs.getApiKey(this));

        // 模式切换：账号密码 ⇄ API Key
        btnMode.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                keyMode = !keyMode;
                applyMode();
            }
        });
        applyMode();

        // 已登录 → 校验凭据有效性后直接进入
        if (Prefs.hasCredential(this) && !base.isEmpty()) {
            verifyAndEnter();
        }

        btnLogin.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                doLogin();
            }
        });
    }

    private void applyMode() {
        etUser.setVisibility(keyMode ? View.GONE : View.VISIBLE);
        etPass.setVisibility(keyMode ? View.GONE : View.VISIBLE);
        etKey.setVisibility(keyMode ? View.VISIBLE : View.GONE);
        btnMode.setText(keyMode ? "改用账号密码登录" : "改用 API Key 连接");
        btnLogin.setText(keyMode ? "连接服务器" : "登录连接");
    }

    private void verifyAndEnter() {
        setStatus("");
        setBusy(true);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    ApiClient.get(LoginActivity.this, "/api/auth/me");
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            setBusy(false);
                            enterMain();
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            setBusy(false);
                            // 凭据失效 → 留在本页重新登录
                        }
                    });
                }
            }
        }).start();
    }

    private void doLogin() {
        final String base = ApiClient.normalizeBase(etServer.getText().toString());
        if (base.isEmpty()) {
            setStatus("请填写服务器地址");
            return;
        }

        if (keyMode) {
            final String key = etKey.getText().toString().trim();
            if (key.isEmpty()) {
                setStatus("请粘贴在网站「设置 → 应用连接」中创建的 API Key");
                return;
            }
            setStatus("正在验证 API Key …");
            setBusy(true);
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        // 先落盘，ApiClient 鉴权会自动使用
                        Prefs.setBase(LoginActivity.this, base);
                        Prefs.setApiKey(LoginActivity.this, key);
                        Prefs.setToken(LoginActivity.this, "");
                        ApiClient.get(LoginActivity.this, "/api/auth/me");
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                setBusy(false);
                                setStatus("");
                                Toast.makeText(LoginActivity.this, "API Key 连接成功", Toast.LENGTH_SHORT).show();
                                enterMain();
                            }
                        });
                    } catch (final Exception e) {
                        // 失败回滚
                        Prefs.setApiKey(LoginActivity.this, "");
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                setBusy(false);
                                setStatus("连接失败：" + e.getMessage());
                            }
                        });
                    }
                }
            }).start();
            return;
        }

        final String user = etUser.getText().toString().trim();
        final String pass = etPass.getText().toString();

        if (user.isEmpty() || pass.isEmpty()) {
            setStatus("请填写用户名和密码");
            return;
        }
        setStatus("正在连接 " + base + " …");
        setBusy(true);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    final String token = ApiClient.login(LoginActivity.this, base, user, pass);
                    Prefs.setBase(LoginActivity.this, base);
                    Prefs.setToken(LoginActivity.this, token);
                    Prefs.setApiKey(LoginActivity.this, "");
                    Prefs.setUsername(LoginActivity.this, user);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            setBusy(false);
                            setStatus("");
                            Toast.makeText(LoginActivity.this, "连接成功", Toast.LENGTH_SHORT).show();
                            enterMain();
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            setBusy(false);
                            setStatus("连接失败：" + e.getMessage());
                        }
                    });
                }
            }
        }).start();
    }

    private void enterMain() {
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }

    private void setBusy(boolean busy) {
        btnLogin.setEnabled(!busy);
        btnLogin.setText(busy ? "连接中…" : (keyMode ? "连接服务器" : "登录连接"));
    }

    private void setStatus(String s) {
        tvStatus.setText(s);
    }
}
