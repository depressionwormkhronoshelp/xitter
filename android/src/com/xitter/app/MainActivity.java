package com.xitter.app;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import java.util.ArrayList;

/** Xitter: нативная оболочка вокруг веб-интерфейса из assets/www. */
public class MainActivity extends Activity {
    private static final int REQ_MEDIA = 42;
    private WebView web;
    private PermissionRequest pendingRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBars();

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor(isDark() ? "#110904" : "#FFF7F0"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " XitterApp/1.0");

        web.addJavascriptInterface(new NativeBridge(), "XitterNative");
        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { handlePermission(request); }
                });
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl("file:///android_asset/www/index.html");
    }

    private static final String[] ICONS = { "orange", "dark", "light", "sunset", "mint", "ocean" };

    /** Мост для веб-интерфейса: смена значка на рабочем столе (Xitter Plus). */
    private class NativeBridge {
        /** Открыть ссылку в браузере (например, скачать новую версию APK). */
        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null || !url.startsWith("https://")) return;
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { startActivity(i); } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void setIcon(String name) {
            boolean known = false;
            for (String n : ICONS) if (n.equals(name)) known = true;
            if (!known) name = "orange";
            PackageManager pm = getPackageManager();
            // сначала включаем нужный значок, потом выключаем остальные, чтобы приложение не пропало с рабочего стола
            pm.setComponentEnabledSetting(new ComponentName(MainActivity.this, getPackageName() + ".Icon_" + name),
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
            for (String n : ICONS) {
                if (n.equals(name)) continue;
                pm.setComponentEnabledSetting(new ComponentName(MainActivity.this, getPackageName() + ".Icon_" + n),
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
            }
        }
    }

    private boolean isDark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applySystemBars() {
        Window w = getWindow();
        int bg = Color.parseColor(isDark() ? "#110904" : "#FFF7F0");
        w.setStatusBarColor(bg);
        w.setNavigationBarColor(bg);
        View d = w.getDecorView();
        int flags = d.getSystemUiVisibility();
        if (isDark()) {
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        } else {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        d.setSystemUiVisibility(flags);
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        applySystemBars();
    }

    private void handlePermission(PermissionRequest request) {
        ArrayList<String> need = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED)
                need.add(Manifest.permission.RECORD_AUDIO);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
                need.add(Manifest.permission.CAMERA);
        }
        if (need.isEmpty()) {
            request.grant(request.getResources());
        } else {
            pendingRequest = request;
            requestPermissions(need.toArray(new String[0]), REQ_MEDIA);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != REQ_MEDIA || pendingRequest == null) return;
        ArrayList<String> grant = new ArrayList<>();
        for (String r : pendingRequest.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grant.add(r);
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) grant.add(r);
        }
        if (grant.isEmpty()) pendingRequest.deny();
        else pendingRequest.grant(grant.toArray(new String[0]));
        pendingRequest = null;
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__xitterBack ? window.__xitterBack() : false", new ValueCallback<String>() {
            @Override public void onReceiveValue(String handled) {
                if (!"true".equals(handled)) {
                    if (web.canGoBack()) web.goBack();
                    else moveTaskToBack(true);
                }
            }
        });
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
}
