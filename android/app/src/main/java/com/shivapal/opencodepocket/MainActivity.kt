package com.shivapal.opencodepocket

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JsResult
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.net.URLEncoder

class MainActivity : AppCompatActivity() {
    companion object {
        const val REQ_NOTIFICATIONS = 42
        const val HOST = "http://127.0.0.1:8099"
        private const val TAG = "Pocket.Main"
    }

    private lateinit var web: WebView
    private lateinit var http: PocketHttpServer
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val filePicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        filePathCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else emptyArray())
        filePathCallback = null
    }

    /** The bundled daemon runs at this port; existing Termux installs use 4096. */
    private val EMBEDDED_PORT = 4098

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Debug builds expose the WebView to chrome://inspect and to
        // adb forward + the DevTools protocol, which is how the on-device DOM
        // can be checked without watching the screen.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        // The loopback host is the web client *and* the API proxy. Starting it
        // before the WebView loads means the first fetch never races the server.
        http = PocketHttpServer(this)
        http.start()

        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(0x00000000) // true black, no flash before the CSS loads
        }
        setContentView(web)
        configureWebView()

        val prefs = getSharedPreferences("pocket", Context.MODE_PRIVATE)
        val runtimeMode = prefs.getString("runtimeMode", "embedded") ?: "embedded"
        if (runtimeMode == "embedded" && prefs.getString("lastRuntimeMode", "") != "embedded") {
            // Cached workspaces belong to the old server; with a fresh local
            // daemon they would be unreachable and every prompt would 500.
            android.webkit.WebStorage.getInstance().deleteAllData()
            val dbDir = java.io.File(filesDir, "opencode-home/.local/share/opencode")
            listOf("opencode.db", "opencode.db-wal", "opencode.db-shm").forEach {
                java.io.File(dbDir, it).delete()
            }
            prefs.edit().putString("lastRuntimeMode", "embedded").apply()
        }

        // Tell the page it is inside the native shell before any app code runs,
        // then inject the back handler once the document is ready.
        web.addJavascriptInterface(PocketBridge(this), "PocketNative")
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                injectBackHandler()
                if (getSharedPreferences("pocket", Context.MODE_PRIVATE)
                        .getString("secret", "").isNullOrEmpty()
                ) injectDefaultBase()
            }

            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                if (url == null) return false
                return if (url.startsWith(HOST) || url.startsWith("blob:") || url.startsWith("data:")) {
                    false
                } else {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    } catch (_: Exception) {
                        Toast.makeText(this@MainActivity, "No app can open that link", Toast.LENGTH_SHORT).show()
                    }
                    true
                }
            }
        }

        // The bundled runtime is the default. Loading the web shell is deferred
        // until it has printed its password, so the first API call never races
        // the daemon. A failure falls back to the verified Termux path.
        if (runtimeMode == "embedded") {
            val progress = android.widget.TextView(this).apply {
                text = "Setting up OpenCode…"
                gravity = android.view.Gravity.CENTER
                setBackgroundColor(android.graphics.Color.BLACK)
                setTextColor(android.graphics.Color.WHITE)
                textSize = 16f
            }
            addContentView(
                progress,
                android.widget.FrameLayout.LayoutParams(
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                    android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                ),
            )
            Thread {
                val cred = EmbeddedRuntime.startAndWait(this@MainActivity, EMBEDDED_PORT)
                runOnUiThread {
                    if (cred != null) {
                        prefs.edit()
                            .putString("base", "http://127.0.0.1:${cred.port}")
                            .putString("secret", cred.secret)
                            .apply()
                    }
                    (progress.parent as? android.view.ViewGroup)?.removeView(progress)
                    loadShell()
                }
            }.start()
        } else {
            loadShell()
        }

        // Start the foreground service so OpenCode is up before the first API
        // call. It is idempotent — tapping the launcher again will not spawn a
        // second server.
        startService(Intent(this, OpencodeService::class.java))
        requestNotificationPermissionIfNeeded()
    }

    private fun loadShell() {
        val prefs = getSharedPreferences("pocket", Context.MODE_PRIVATE)
        val base = prefs.getString("base", "") ?: ""
        val secret = prefs.getString("secret", "") ?: ""
        val appBase = HOST
        val url = if (secret.isNotEmpty()) {
            "$appBase/?base=${URLEncoder.encode(base, "UTF-8")}&secret=${URLEncoder.encode(secret, "UTF-8")}"
        } else {
            "$appBase/"
        }
        web.loadUrl(url)
    }

    private fun configureWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString OpenCodePocket/1.0"
            // Needed so a file chosen by the user can be read by the page.
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            web.settings.safeBrowsingEnabled = false // only loopback content is loaded
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?,
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                filePicker.launch("image/*")
                return true
            }

            override fun onConsoleMessage(msg: ConsoleMessage?): Boolean {
                if (msg != null) {
                    Log.d(TAG, "console: ${msg.message()} @ ${msg.sourceId()}:${msg.lineNumber()}")
                }
                return true
            }

            override fun onJsAlert(
                view: WebView?,
                url: String?,
                message: String?,
                result: JsResult?,
            ): Boolean {
                result?.confirm()
                return true
            }
        }

        web.setDownloadListener { url, _, _, mime, _ ->
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                // The web client routes exports through PocketNative.saveText;
                // this is a fallback for anything that still uses an anchor.
                web.evaluateJavascript(
                    "PocketNative.toast('Use the Share action to save this file');", null
                )
            } else {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK
                }
                try {
                    startActivity(intent)
                } catch (_: Exception) {
                    Toast.makeText(this, "No app can open that file", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    /**
     * The client tracks sheets, the open chat and the artifact workspace in the
     * browser history. A native back press asks the page to unwind one of those
     * first; only when nothing is open does the app exit.
     */
    private fun injectBackHandler() {
        val js = """
            (function () {
              if (window.__pocketBackReady) return;
              window.__pocketBackReady = true;
              window.pocketBack = function () {
                var art = document.getElementById('artifact');
                if (art && !art.hidden) { document.getElementById('artifact-back').click(); return 'handled'; }
                var sheet = document.getElementById('sheet');
                if (sheet && !sheet.hidden) { document.getElementById('sheet-close').click(); return 'handled'; }
                var chat = document.getElementById('screen-chat');
                if (chat && !chat.hidden) { document.getElementById('chat-back').click(); return 'handled'; }
                return 'exit';
              };
            })();
        """.trimIndent().replace("\n", " ")
        web.evaluateJavascript(js, null)
    }

    /** On a fresh install, point the connect form at the loopback proxy. */
    private fun injectDefaultBase() {
        val js = """
            (function () {
              var f = document.getElementById('connect-url');
              if (f && (!f.value || f.value.indexOf('4096') !== -1)) f.value = '$HOST';
            })();
        """.trimIndent().replace("\n", " ")
        web.evaluateJavascript(js, null)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.pocketBack ? window.pocketBack() : 'exit'") { result ->
            val value = result?.trim('"')
            if (value == "exit") {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFICATIONS)
            }
        }
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        http.stop()
        super.onDestroy()
    }
}
