package com.shivapal.opencodepocket

import android.app.NotificationManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.widget.Toast
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * The small, explicit surface the web client may call. Every method is
 * deliberately narrow: no arbitrary file access, no command execution, no way
 * to read the server password back out of native code. Generated HTML lives in
 * a sandboxed iframe and cannot reach this object.
 */
class PocketBridge(private val activity: MainActivity) {
    private val prefs by lazy {
        activity.getSharedPreferences("pocket", Context.MODE_PRIVATE)
    }

    @android.webkit.JavascriptInterface
    fun isNative(): Boolean = true

    @android.webkit.JavascriptInterface
    fun getConfig(): String {
        val base = prefs.getString("base", "") ?: ""
        val secret = prefs.getString("secret", "") ?: ""
        return JSONObject().put("base", base).put("secret", secret).toString()
    }

    @android.webkit.JavascriptInterface
    fun saveConfig(base: String, secret: String) {
        prefs.edit().putString("base", base).putString("secret", secret).apply()
    }

    @android.webkit.JavascriptInterface
    fun haptic(ms: Long) {
        if (ms <= 0) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = activity.getSystemService(VibratorManager::class.java)
                manager?.defaultVibrator?.vibrate(
                    VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)
                )
            } else {
                @Suppress("DEPRECATION")
                val vibrator = activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                vibrator?.vibrate(ms)
            }
        } catch (_: Exception) {
        }
    }

    @android.webkit.JavascriptInterface
    fun copyToClipboard(text: String) {
        val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("OpenCode Pocket", text))
        toast("Copied")
    }

    /** Save generated text to the Downloads folder without relying on blob:
     *  downloads, which WebView handles inconsistently. */
    @android.webkit.JavascriptInterface
    fun saveText(name: String, text: String, mime: String) {
        activity.runOnUiThread {
            try {
                val safeName = name.replace(Regex("[^\\w.-]"), "-").take(120)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.Downloads.DISPLAY_NAME, safeName)
                        put(android.provider.MediaStore.Downloads.MIME_TYPE, mime)
                        put(android.provider.MediaStore.Downloads.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
                    }
                    val uri = activity.contentResolver.insert(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values
                    )
                    uri?.let { u ->
                        activity.contentResolver.openOutputStream(u)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                    }
                } else {
                    @Suppress("DEPRECATION")
                    val dir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
                    java.io.File(dir, safeName).writeBytes(text.toByteArray(Charsets.UTF_8))
                }
                toast("Saved $safeName")
            } catch (e: Exception) {
                toast("Could not save: ${e.message}")
            }
        }
    }

    @android.webkit.JavascriptInterface
    fun shareText(text: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        activity.startActivity(Intent.createChooser(intent, "Share"))
    }

    @android.webkit.JavascriptInterface
    fun openExternal(url: String) {
        if (!url.startsWith("https://", ignoreCase = true)) return
        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    @android.webkit.JavascriptInterface
    fun toast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    @android.webkit.JavascriptInterface
    fun notify(title: String, body: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) return
        // Notifications are posted by the service; this bridge exists so a
        // finished turn can surface one when the app is in the background.
        val intent = Intent(activity, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = android.app.PendingIntent.getActivity(
            activity, 0, intent,
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
        val notification = androidx.core.app.NotificationCompat.Builder(activity, PocketApp.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        activity.getSystemService(NotificationManager::class.java).notify(2001, notification)
    }

    @android.webkit.JavascriptInterface
    fun requestNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.requestPermissions(
                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                MainActivity.REQ_NOTIFICATIONS,
            )
        }
    }

    @android.webkit.JavascriptInterface
    fun serviceRunning(): Boolean = OpencodeService.isRunning

    /** A writable default project for the built-in runtime. */
    @android.webkit.JavascriptInterface
    fun workspaceDir(): String {
        val dir = java.io.File(activity.filesDir, "opencode-home/workspace")
        dir.mkdirs()
        return dir.absolutePath
    }

    @android.webkit.JavascriptInterface
    fun runtimeMode(): String =
        prefs.getString("runtimeMode", "embedded") ?: "embedded"

    @android.webkit.JavascriptInterface
    fun setRuntimeMode(mode: String) {
        if (mode != "embedded" && mode != "termux") return
        prefs.edit().putString("runtimeMode", mode).apply()
        if (mode == "embedded") {
            // A fresh daemon must not inherit sessions/config from the other
            // runtime; MainActivity rebuilds the local store on next launch.
            prefs.edit().putString("lastRuntimeMode", "").apply()
            val dir = java.io.File(activity.filesDir, "opencode-home/.local/share/opencode")
            listOf("opencode.db", "opencode.db-wal", "opencode.db-shm").forEach {
                java.io.File(dir, it).delete()
            }
        }
    }
}
