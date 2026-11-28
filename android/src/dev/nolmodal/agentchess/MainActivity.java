package dev.nolmodal.agentchess;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.IOException;
import java.io.InputStream;

/**
 * EPIC Chess — WebView shell.
 *
 * The bundle is served from a synthetic https origin instead of file:// so the
 * page gets a real origin: Blob workers, localStorage and Web Audio all behave
 * the way they do on the web. Everything is intercepted from assets/, so the
 * app never touches the network.
 *
 * The shell is deliberately defensive: if the WebView cannot be created, the
 * renderer dies, or the page fails to load, the user gets a readable native
 * screen with a retry button instead of a silent crash.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.local";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int BG = 0xFF08090C;

    private FrameLayout root;
    private WebView web;
    private boolean recovering;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);

        configureWindow();
        showWebView();
    }

    // ------------------------------------------------------------- window

    private void configureWindow() {
        try {
            Window window = getWindow();
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
        } catch (Throwable ignored) {
            // Some OEM themes reject colour changes; the app still runs.
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Window window = getWindow();
                window.setDecorFitsSystemWindows(false);
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.setSystemBarsAppearance(
                            0,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                }
            } catch (Throwable ignored) {
                // Never let chrome configuration take the app down.
            }
        } else {
            try {
                getWindow().getDecorView().setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
            } catch (Throwable ignored) {
                // ignore
            }
        }

        applyInsets();
    }

    private void applyInsets() {
        if (root == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                    @Override
                    public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
                        Insets bars = insets.getInsets(
                                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                        view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                        return insets;
                    }
                });
            } catch (Throwable ignored) {
                // ignore
            }
        } else {
            root.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        WindowInsets insets = root.getRootWindowInsets();
                        if (insets == null) return;
                        root.setPadding(
                                insets.getSystemWindowInsetLeft(),
                                insets.getSystemWindowInsetTop(),
                                insets.getSystemWindowInsetRight(),
                                insets.getSystemWindowInsetBottom());
                    } catch (Throwable ignored) {
                        // ignore
                    }
                }
            });
        }
    }

    // ------------------------------------------------------------- webview

    private void showWebView() {
        if (recovering) return;
        recovering = true;

        try {
            if (web != null) {
                root.removeView(web);
                web.destroy();
                web = null;
            }

            WebView candidate = new WebView(this);
            candidate.setBackgroundColor(BG);
            candidate.setOverScrollMode(View.OVER_SCROLL_NEVER);
            candidate.setVerticalScrollBarEnabled(false);
            candidate.setHorizontalScrollBarEnabled(false);

            WebSettings settings = candidate.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(false);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setTextZoom(100);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(false);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setSupportMultipleWindows(false);
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

            candidate.setWebViewClient(new Client());
            candidate.setLayerType(View.LAYER_TYPE_HARDWARE, null);

            root.removeAllViews();
            root.addView(candidate, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));

            web = candidate;
            recovering = false;
            candidate.loadUrl(START_URL);
        } catch (Throwable error) {
            recovering = false;
            showFallback(error);
        }
    }

    private void showFallback(Throwable error) {
        try {
            if (web != null) {
                try {
                    root.removeView(web);
                    web.destroy();
                } catch (Throwable ignored) {
                    // ignore
                }
                web = null;
            }

            root.removeAllViews();

            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setGravity(Gravity.CENTER);
            box.setPadding(48, 48, 48, 48);

            TextView title = new TextView(this);
            title.setText("EPIC Chess");
            title.setTextColor(0xFFF2EDE4);
            title.setTextSize(26f);
            title.setGravity(Gravity.CENTER);

            TextView detail = new TextView(this);
            detail.setText("The board could not start on this device.\n" +
                    (error == null || error.getMessage() == null ? "" : error.getMessage()));
            detail.setTextColor(0xFF9AA0A8);
            detail.setTextSize(13f);
            detail.setGravity(Gravity.CENTER);
            detail.setPadding(0, 18, 0, 26);

            Button retry = new Button(this);
            retry.setText("Try again");
            retry.setAllCaps(false);
            retry.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showWebView();
                }
            });

            box.addView(title);
            box.addView(detail);
            box.addView(retry);
            root.addView(box, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
        } catch (Throwable ignored) {
            // If even the fallback cannot be built there is nothing left to do.
        }
    }

    private final class Client extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            try {
                Uri uri = request.getUrl();
                if (uri != null && HOST.equals(uri.getHost())) {
                    String path = uri.getPath();
                    if (path == null || path.isEmpty() || "/".equals(path)) {
                        path = "/index.html";
                    }
                    InputStream stream = getAssets().open(path.substring(1));
                    return new WebResourceResponse(mimeFor(path), "utf-8", 200, "OK", null, stream);
                }
            } catch (IOException ignored) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
            } catch (Throwable ignored) {
                // fall through to the default handling
            }
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request != null && request.isForMainFrame()) {
                showFallback(new RuntimeException("The page did not load."));
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Returning true tells the system we handled the crash; without it
            // the whole process is killed and the app disappears.
            try {
                if (web != null) {
                    root.removeView(web);
                    web.destroy();
                    web = null;
                }
            } catch (Throwable ignored) {
                // ignore
            }
            showFallback(new RuntimeException("The graphics process restarted."));
            return true;
        }
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    // ------------------------------------------------------------ lifecycle

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            try {
                root.removeView(web);
                web.destroy();
            } catch (Throwable ignored) {
                // ignore
            }
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
