package com.papermarker.app;

import android.content.Context;
import android.content.SharedPreferences;

/** 轻量偏好存储：服务端地址 / Token / API Key / 用户名 */
public class Prefs {
    private static final String SP = "pm_prefs";

    private static SharedPreferences sp(Context c) {
        return c.getSharedPreferences(SP, Context.MODE_PRIVATE);
    }

    public static String getBase(Context c) {
        return sp(c).getString("base", "");
    }

    public static void setBase(Context c, String v) {
        sp(c).edit().putString("base", v).apply();
    }

    public static String getToken(Context c) {
        return sp(c).getString("token", "");
    }

    public static void setToken(Context c, String v) {
        sp(c).edit().putString("token", v).apply();
    }

    /** 应用连接 API Key（在网站“设置 → 应用连接”中创建） */
    public static String getApiKey(Context c) {
        return sp(c).getString("apiKey", "");
    }

    public static void setApiKey(Context c, String v) {
        sp(c).edit().putString("apiKey", v).apply();
    }

    public static String getUsername(Context c) {
        return sp(c).getString("username", "");
    }

    public static void setUsername(Context c, String v) {
        sp(c).edit().putString("username", v).apply();
    }

    /** 当前是否已具备任何一种登录凭据 */
    public static boolean hasCredential(Context c) {
        return !getToken(c).isEmpty() || !getApiKey(c).isEmpty();
    }

    /** 清除登录态（退出登录） */
    public static void clearLogin(Context c) {
        sp(c).edit().remove("token").remove("apiKey").apply();
    }
}
