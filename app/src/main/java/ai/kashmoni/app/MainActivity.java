package ai.kashmoni.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Kash Moni AI for Android.
 *  - chatView: the Kash Moni app UI (HTML/JS in assets/app), the "brain".
 *  - browserView: a built-in browser the AI can see and control.
 *  - Bridge: lets the JS app make network calls (no CORS limits), save chats,
 *    control the built-in browser, take screenshots and save downloads.
 */
public class MainActivity extends Activity {

    private WebView chatView;
    private WebView browserView;
    private LinearLayout browserBox;
    private EditText urlBar;
    private ProgressBar progress;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private final List<JSONObject> consoleLog = new ArrayList<>();
    private final List<JSONObject> netLog = new ArrayList<>();
    private int pageProgress = 100;
    private boolean pageLoading = false;

    private static final int BG = Color.parseColor("#0d1210");
    private static final int PANEL = Color.parseColor("#141b18");
    private static final int GREEN = Color.parseColor("#22c55e");

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(PANEL);
        getWindow().setNavigationBarColor(PANEL);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        // ---------------- built-in browser (bottom layer, always laid out so screenshots work)
        browserBox = new LinearLayout(this);
        browserBox.setOrientation(LinearLayout.VERTICAL);
        browserBox.setBackgroundColor(PANEL);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(6), dp(6), dp(6), dp(6));

        Button back = smallButton("◀");
        back.setOnClickListener(v -> { if (browserView.canGoBack()) browserView.goBack(); });
        Button reload = smallButton("⟳");
        reload.setOnClickListener(v -> browserView.reload());
        urlBar = new EditText(this);
        urlBar.setSingleLine(true);
        urlBar.setTextSize(14);
        urlBar.setTextColor(Color.WHITE);
        urlBar.setHintTextColor(Color.GRAY);
        urlBar.setHint("Type a URL or search");
        urlBar.setImeOptions(EditorInfo.IME_ACTION_GO);
        urlBar.setOnEditorActionListener((v, actionId, event) -> {
            String t = urlBar.getText().toString().trim();
            if (!t.isEmpty()) {
                browserView.loadUrl(fixUrl(t));
                hideKeyboard();
            }
            return true;
        });
        Button chatBtn = smallButton("💬 Chat");
        chatBtn.setTextColor(GREEN);
        chatBtn.setOnClickListener(v -> showChat(true));
        bar.addView(back);
        bar.addView(reload);
        bar.addView(urlBar, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(chatBtn);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);

        browserView = new WebView(this);
        setupBrowser();
        browserBox.addView(bar);
        browserBox.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
        browserBox.addView(browserView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(browserBox, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // ---------------- chat app (top layer)
        chatView = new WebView(this);
        chatView.setBackgroundColor(BG);
        WebSettings cs = chatView.getSettings();
        cs.setJavaScriptEnabled(true);
        cs.setDomStorageEnabled(true);
        cs.setAllowFileAccess(true);
        chatView.addJavascriptInterface(new Bridge(), "KMAndroid");
        chatView.setWebChromeClient(new WebChromeClient());
        chatView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // links in chat open in the built-in browser
                browserView.loadUrl(request.getUrl().toString());
                showChat(false);
                return true;
            }
        });
        root.addView(chatView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        chatView.loadUrl("file:///android_asset/app/index.html");
        browserView.loadUrl("https://duckduckgo.com/");

        // Share a link into the app -> opens it in the built-in browser
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;
        String text = null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) text = intent.getStringExtra(Intent.EXTRA_TEXT);
        else if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) text = intent.getData().toString();
        if (text == null) return;
        int i = text.indexOf("http");
        if (i >= 0) {
            String url = text.substring(i).split("\\s")[0];
            browserView.loadUrl(url);
            final String shared = text;
            ui.postDelayed(() -> callJs("window.KMApp && KMApp.onShared(" + JSONObject.quote(shared) + ")"), 1500);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupBrowser() {
        WebSettings s = browserView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browserView, true);
        WebView.setWebContentsDebuggingEnabled(true);

        browserView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                pageProgress = p;
                progress.setProgress(p);
                progress.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("time", now());
                    o.put("level", m.messageLevel().name().toLowerCase(Locale.US));
                    o.put("text", m.message());
                    o.put("where", m.sourceId() + ":" + m.lineNumber());
                    synchronized (consoleLog) {
                        consoleLog.add(o);
                        if (consoleLog.size() > 400) consoleLog.remove(0);
                    }
                } catch (Exception ignored) { }
                return true;
            }
        });

        browserView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                pageLoading = true;
                urlBar.setText(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageLoading = false;
                urlBar.setText(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String scheme = request.getUrl().getScheme();
                if ("http".equals(scheme) || "https".equals(scheme)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                try {
                    JSONObject o = new JSONObject();
                    o.put("id", "r" + System.nanoTime());
                    o.put("time", now());
                    o.put("method", req.getMethod());
                    o.put("url", req.getUrl().toString());
                    o.put("main", req.isForMainFrame());
                    synchronized (netLog) {
                        netLog.add(o);
                        if (netLog.size() > 600) netLog.remove(0);
                    }
                } catch (Exception ignored) { }
                return null; // let the WebView load it normally
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse res) {
                markNet(req.getUrl().toString(), "status", String.valueOf(res.getStatusCode()));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                markNet(req.getUrl().toString(), "failed", String.valueOf(err.getDescription()));
            }
        });
    }

    private void markNet(String url, String key, String value) {
        synchronized (netLog) {
            for (int i = netLog.size() - 1; i >= 0; i--) {
                JSONObject o = netLog.get(i);
                if (url.equals(o.optString("url")) && !o.has(key)) {
                    try { o.put(key, value); } catch (Exception ignored) { }
                    return;
                }
            }
        }
    }

    // ------------------------------------------------------------------ helpers
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private String now() { return new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date()); }

    private Button smallButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(14);
        b.setTextColor(Color.WHITE);
        b.setBackgroundColor(Color.TRANSPARENT);
        b.setMinWidth(dp(40));
        b.setMinimumWidth(dp(40));
        b.setPadding(dp(8), 0, dp(8), 0);
        return b;
    }

    private static String fixUrl(String t) {
        if (t.matches("^[a-zA-Z][a-zA-Z0-9+.-]*://.*")) return t;
        if (t.contains(" ") || !t.contains(".")) {
            try { return "https://duckduckgo.com/?q=" + java.net.URLEncoder.encode(t, "UTF-8"); } catch (Exception e) { return t; }
        }
        if (t.startsWith("localhost") || t.startsWith("127.") || t.startsWith("192.168.") || t.startsWith("10.")) return "http://" + t;
        return "https://" + t;
    }

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(urlBar.getWindowToken(), 0);
    }

    private void showChat(boolean show) {
        chatView.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) hideKeyboard();
        callJs("window.KMApp && KMApp.onView(" + (show ? "'chat'" : "'browser'") + ")");
    }

    private void callJs(String js) {
        ui.post(() -> chatView.evaluateJavascript(js, null));
    }

    /** Send a result back to the JS app: KMNative.done(id, jsonString) */
    private void done(String id, JSONObject result) {
        callJs("window.KMNative && KMNative.done(" + JSONObject.quote(id) + "," + JSONObject.quote(result.toString()) + ")");
    }

    private JSONObject err(String msg) {
        JSONObject o = new JSONObject();
        try { o.put("error", msg); } catch (Exception ignored) { }
        return o;
    }

    @Override
    public void onBackPressed() {
        if (chatView.getVisibility() != View.VISIBLE) {
            if (browserView.canGoBack()) browserView.goBack();
            else showChat(true);
        } else {
            callJs("window.KMApp && KMApp.onBack()");
        }
    }

    // ------------------------------------------------------------------ JS bridge
    public class Bridge {

        @JavascriptInterface
        public String loadState() {
            File f = new File(getFilesDir(), "state.json");
            if (!f.exists()) return "{}";
            try (FileInputStream in = new FileInputStream(f)) {
                return new String(readAll(in), StandardCharsets.UTF_8);
            } catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface
        public void saveState(String json) {
            new Thread(() -> {
                File tmp = new File(getFilesDir(), "state.json.tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                } catch (Exception e) { return; }
                //noinspection ResultOfMethodCallIgnored
                tmp.renameTo(new File(getFilesDir(), "state.json"));
            }).start();
        }

        @JavascriptInterface
        public void toast(String msg) {
            ui.post(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void exitApp() { ui.post(() -> moveTaskToBack(true)); }

        @JavascriptInterface
        public void showBrowser() { ui.post(() -> showChat(false)); }

        @JavascriptInterface
        public void showChatView() { ui.post(() -> showChat(true)); }

        @JavascriptInterface
        public void openExternal(String url) {
            ui.post(() -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
            });
        }

        /** Generic HTTP request without browser CORS limits. */
        @JavascriptInterface
        public void http(String id, String method, String url, String headersJson, String body, int timeoutSec) {
            new Thread(() -> {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setRequestMethod(method == null || method.isEmpty() ? "GET" : method);
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(Math.max(10, timeoutSec) * 1000);
                    c.setInstanceFollowRedirects(true);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) KashMoniAI/1.0");
                    if (headersJson != null && !headersJson.isEmpty()) {
                        JSONObject h = new JSONObject(headersJson);
                        Iterator<String> keys = h.keys();
                        while (keys.hasNext()) {
                            String k = keys.next();
                            c.setRequestProperty(k, h.getString(k));
                        }
                    }
                    if (body != null && !body.isEmpty()) {
                        c.setDoOutput(true);
                        try (OutputStream os = c.getOutputStream()) {
                            os.write(body.getBytes(StandardCharsets.UTF_8));
                        }
                    }
                    int status = c.getResponseCode();
                    InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                    String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);
                    JSONObject res = new JSONObject();
                    res.put("status", status);
                    res.put("body", text);
                    JSONObject hdr = new JSONObject();
                    for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                        if (e.getKey() != null && e.getValue() != null && !e.getValue().isEmpty())
                            hdr.put(e.getKey().toLowerCase(Locale.US), e.getValue().get(0));
                    }
                    res.put("headers", hdr);
                    done(id, res);
                } catch (Exception e) {
                    done(id, err(e.getClass().getSimpleName() + ": " + e.getMessage()));
                } finally {
                    if (c != null) c.disconnect();
                }
            }).start();
        }

        /** Download a URL into Downloads/<filename> (filename may contain one folder). */
        @JavascriptInterface
        public void download(String id, String url, String filename) {
            new Thread(() -> {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(120000);
                    int status = c.getResponseCode();
                    if (status >= 400) { done(id, err("HTTP " + status)); return; }
                    String name = filename;
                    String sub = "";
                    int slash = filename.lastIndexOf('/');
                    if (slash > 0) { sub = filename.substring(0, slash); name = filename.substring(slash + 1); }
                    OutputStream out;
                    String where;
                    if (Build.VERSION.SDK_INT >= 29) {
                        ContentValues v = new ContentValues();
                        v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                        v.put(MediaStore.Downloads.MIME_TYPE, name.endsWith(".zip") ? "application/zip" : "application/octet-stream");
                        v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + (sub.isEmpty() ? "" : "/" + sub));
                        Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                        if (uri == null) { done(id, err("Could not create the file in Downloads")); return; }
                        out = getContentResolver().openOutputStream(uri);
                        where = "Downloads/" + (sub.isEmpty() ? "" : sub + "/") + name;
                    } else {
                        File dir = new File(getExternalFilesDir(null), sub);
                        //noinspection ResultOfMethodCallIgnored
                        dir.mkdirs();
                        File f = new File(dir, name);
                        out = new FileOutputStream(f);
                        where = f.getAbsolutePath();
                    }
                    try (InputStream in = c.getInputStream(); OutputStream o = out) {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
                    }
                    JSONObject res = new JSONObject();
                    res.put("ok", true);
                    res.put("path", where);
                    done(id, res);
                    toast("Saved to " + where);
                } catch (Exception e) {
                    done(id, err(e.getClass().getSimpleName() + ": " + e.getMessage()));
                } finally {
                    if (c != null) c.disconnect();
                }
            }).start();
        }

        /** Control the built-in browser. action: open, eval, state, back, reload, screenshot, console, network, clear */
        @JavascriptInterface
        public void browser(String id, String action, String argsJson) {
            ui.post(() -> {
                try {
                    JSONObject a = argsJson == null || argsJson.isEmpty() ? new JSONObject() : new JSONObject(argsJson);
                    JSONObject res = new JSONObject();
                    switch (action) {
                        case "open":
                            browserView.loadUrl(fixUrl(a.optString("url")));
                            res.put("ok", true);
                            done(id, res);
                            break;
                        case "eval":
                            browserView.evaluateJavascript(a.optString("code"), new ValueCallback<String>() {
                                @Override
                                public void onReceiveValue(String value) {
                                    JSONObject r = new JSONObject();
                                    try { r.put("value", value == null ? "null" : value); } catch (Exception ignored) { }
                                    done(id, r);
                                }
                            });
                            break;
                        case "state":
                            res.put("url", browserView.getUrl() == null ? "" : browserView.getUrl());
                            res.put("title", browserView.getTitle() == null ? "" : browserView.getTitle());
                            res.put("progress", pageProgress);
                            res.put("loading", pageLoading || pageProgress < 100);
                            res.put("canGoBack", browserView.canGoBack());
                            res.put("visible", chatView.getVisibility() != View.VISIBLE);
                            done(id, res);
                            break;
                        case "back":
                            if (browserView.canGoBack()) browserView.goBack();
                            res.put("ok", true);
                            done(id, res);
                            break;
                        case "reload":
                            browserView.reload();
                            res.put("ok", true);
                            done(id, res);
                            break;
                        case "screenshot": {
                            int w = browserView.getWidth(), h = browserView.getHeight();
                            if (w <= 0 || h <= 0) { done(id, err("Browser is not laid out yet")); break; }
                            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
                            Canvas cv = new Canvas(bmp);
                            cv.drawColor(Color.WHITE);
                            browserView.draw(cv);
                            int maxW = 720;
                            if (w > maxW) {
                                Bitmap scaled = Bitmap.createScaledBitmap(bmp, maxW, Math.round(h * (maxW / (float) w)), true);
                                bmp.recycle();
                                bmp = scaled;
                            }
                            ByteArrayOutputStream bos = new ByteArrayOutputStream();
                            bmp.compress(Bitmap.CompressFormat.JPEG, 60, bos);
                            bmp.recycle();
                            res.put("dataUrl", "data:image/jpeg;base64," + Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                            done(id, res);
                            break;
                        }
                        case "console": {
                            JSONArray arr = new JSONArray();
                            synchronized (consoleLog) { for (JSONObject o : consoleLog) arr.put(o); }
                            res.put("items", arr);
                            done(id, res);
                            break;
                        }
                        case "network": {
                            JSONArray arr = new JSONArray();
                            synchronized (netLog) { for (JSONObject o : netLog) arr.put(o); }
                            res.put("items", arr);
                            done(id, res);
                            break;
                        }
                        case "clear":
                            synchronized (consoleLog) { consoleLog.clear(); }
                            synchronized (netLog) { netLog.clear(); }
                            res.put("ok", true);
                            done(id, res);
                            break;
                        default:
                            done(id, err("unknown browser action " + action));
                    }
                } catch (Exception e) {
                    done(id, err(e.getClass().getSimpleName() + ": " + e.getMessage()));
                }
            });
        }
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toByteArray();
    }
}
