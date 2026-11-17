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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
        val secret = prefs.getString("secret", "") ?: ""
        val url = if (secret.isNotEmpty()) {
            "$HOST/?base=$HOST&secret=${URLEncoder.encode(secret, "UTF-8")}"
        } else {
            "$HOST/"
        }

        // Tell the page it is inside the native shell before any app code runs,
        // then inject the back handler once the document is ready.
        web.addJavascriptInterface(PocketBridge(this), "PocketNative")
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                injectBackHandler()
                if (secret.isEmpty()) injectDefaultBase()
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

        web.loadUrl(url)

        // Start the foreground service so OpenCode is up before the first API
        // call. It is idempotent — tapping the launcher again will not spawn a
        // second server.
        startService(Intent(this, OpencodeService::class.java))
        requestNotificationPermissionIfNeeded()
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
