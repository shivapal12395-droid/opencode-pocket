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
import android.print.PrintAttributes
import android.print.PrintManager
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
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

    /** The offscreen WebView a print job is reading from. Held so the system
     *  print service can paginate it after the JS call has returned. */
    private var printView: WebView? = null

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

    /**
     * Hand a self-contained document to the system print dialog. "Save as PDF"
     * in that dialog is the PDF export; there is no second renderer here and no
     * silent failure — a refused job comes back as a toast.
     *
     * The WebView has to be attached and laid out: `createPrintDocumentAdapter`
     * paginates what the view actually renders, and a detached view prints one
     * blank page. It is placed off-screen at A4 width and kept alive until the
     * next print, because the adapter is still reading it when this returns.
     */
    @android.webkit.JavascriptInterface
    fun printHtml(html: String, jobName: String): Boolean {
        activity.runOnUiThread {
            try {
                val root = activity.findViewById<ViewGroup>(android.R.id.content)
                printView?.let { old -> (old.parent as? ViewGroup)?.removeView(old) }
                val web = WebView(activity)
                web.settings.javaScriptEnabled = false // the document is static
                web.setBackgroundColor(android.graphics.Color.WHITE)
                web.isClickable = false
                // Laid out and painted, but 99.99% transparent and pushed off
                // screen: the print adapter paginates what was rendered, and a
                // view that never painted gives a blank page.
                web.alpha = 0.01f
                web.translationY = 100_000f
                var started = false
                web.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView, url: String?) {
                        if (started) return
                        started = true
                        view.post {
                            try {
                                val title = jobName.take(60).ifBlank { "OpenCode Pocket" }
                                val manager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
                                val adapter = view.createPrintDocumentAdapter(title)
                                val attrs = PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                    .build()
                                manager.print(title, adapter, attrs)
                            } catch (e: Exception) {
                                toast("Could not print: ${e.message}")
                            }
                        }
                    }
                }
                root?.addView(web, ViewGroup.LayoutParams(794, 1123))
                printView = web
                web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
            } catch (e: Exception) {
                toast("Could not print: ${e.message}")
            }
        }
        return true
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
    fun restartRuntime(): Boolean {
        return try {
            RuntimeSupervisor.reset()
            activity.startService(Intent(activity, OpencodeService::class.java).setAction(OpencodeService.ACTION_STOP))
            // A real restart: the daemon process goes away too, so the next
            // ensure() starts a new one instead of reusing the old.
            EmbeddedRuntime.killAll(activity)
            activity.startService(Intent(activity, OpencodeService::class.java))
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                activity.recreate()
            }, 1800)
            true
        } catch (_: Throwable) {
            false
        }
    }

    @android.webkit.JavascriptInterface
    fun runtimeInfo(): String {
        val live = RuntimeSupervisor.snapshot
        return org.json.JSONObject()
            .put("mode", RuntimeSupervisor.mode(activity))
            .put("port", live?.port ?: 0)
            .put("connected", live != null)
            .toString()
    }

    @android.webkit.JavascriptInterface
    fun serviceRunning(): Boolean = OpencodeService.isRunning

    // ---- data safety ------------------------------------------------------
    //
    // The runtime's own store (sessions, messages, settings, provider logins)
    // lives in app-private storage, which Android deletes on uninstall. These
    // two methods move a copy of that store out to Downloads and back, so a
    // reinstall can recover the original sessions with their original ids.
    //
    // Nothing here is ever automatic: a restore only runs when the user asks,
    // and the data that is replaced is moved aside, never deleted.

    private fun runtimeHome(): java.io.File = java.io.File(activity.filesDir, "opencode-home")

    private val backupFolder = "OpenCodePocket"

    private fun backupFile(name: String): java.io.File? {
        val dir = java.io.File(activity.getExternalFilesDir(null), backupFolder)
        val file = java.io.File(dir, name.substringAfterLast('/').substringAfterLast('\\'))
        return if (file.exists()) file else null
    }

    /**
     * Zip the runtime home (minus the project workspace, which is the user's
     * code and not Pocket's to duplicate) into Downloads.
     */
    @android.webkit.JavascriptInterface
    fun backupRuntime(): String {
        val name = "opencode-backup-" +
            java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US).format(java.util.Date()) + ".zip"
        return try {
            val root = runtimeHome()
            if (!root.exists()) {
                return JSONObject().put("ok", false).put("error", "There is no runtime data to back up yet").toString()
            }
            val workspace = java.io.File(root, "workspace").path
            val tmp = java.io.File(activity.cacheDir, name)
            var entries = 0
            java.util.zip.ZipOutputStream(java.io.BufferedOutputStream(java.io.FileOutputStream(tmp))).use { zip ->
                for (f in root.walkTopDown()) {
                    if (!f.isFile) continue
                    if (f.path.startsWith(workspace)) continue          // the project itself
                    if (f.name == "embedded-runtime.log") continue
                    // opencode.db-wal / -shm are copied on purpose: the database
                    // runs in WAL mode, so the newest turns only exist there
                    // until a checkpoint. SQLite replays them when it reopens.
                    val rel = f.relativeTo(root).invariantSeparatorsPath
                    zip.putNextEntry(java.util.zip.ZipEntry(rel))
                    f.inputStream().use { it.copyTo(zip) }
                    zip.closeEntry()
                    entries += 1
                }
            }
            val bytes = tmp.length()
            val where = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name)
                    put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/zip")
                    put(
                        android.provider.MediaStore.Downloads.RELATIVE_PATH,
                        android.os.Environment.DIRECTORY_DOWNLOADS + "/" + backupFolder,
                    )
                }
                val uri = activity.contentResolver.insert(
                    android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values
                ) ?: throw IllegalStateException("Downloads refused the file")
                activity.contentResolver.openOutputStream(uri)?.use { out ->
                    tmp.inputStream().use { it.copyTo(out) }
                } ?: throw IllegalStateException("could not write the backup")
                "Downloads/$backupFolder/$name"
            } else {
                val dir = java.io.File(activity.getExternalFilesDir(null), backupFolder).also { it.mkdirs() }
                val dst = java.io.File(dir, name)
                tmp.copyTo(dst, overwrite = true)
                dst.absolutePath
            }
            tmp.delete()
            JSONObject().put("ok", true).put("name", name).put("bytes", bytes)
                .put("entries", entries).put("where", where).toString()
        } catch (t: Throwable) {
            JSONObject().put("ok", false).put("error", t.message ?: "backup failed").toString()
        }
    }

    /** Every backup on the device, newest first. */
    @android.webkit.JavascriptInterface
    fun listRuntimeBackups(): String {
        val out = org.json.JSONArray()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val cols = arrayOf(
                    android.provider.MediaStore.Downloads.DISPLAY_NAME,
                    android.provider.MediaStore.Downloads.SIZE,
                    android.provider.MediaStore.Downloads.DATE_ADDED,
                )
                val where = android.provider.MediaStore.Downloads.RELATIVE_PATH + " LIKE ?"
                activity.contentResolver.query(
                    android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    cols, where, arrayOf("%$backupFolder%"),
                    android.provider.MediaStore.Downloads.DATE_ADDED + " DESC",
                )?.use { c ->
                    while (c.moveToNext()) {
                        val n = c.getString(0) ?: continue
                        if (!n.startsWith("opencode-backup-") || !n.endsWith(".zip")) continue
                        out.put(
                            JSONObject().put("name", n).put("bytes", c.getLong(1))
                                .put("at", c.getLong(2) * 1000L)
                        )
                    }
                }
            } else {
                val dir = java.io.File(activity.getExternalFilesDir(null), backupFolder)
                dir.listFiles()?.sortedByDescending { it.lastModified() }?.forEach { f ->
                    if (f.name.startsWith("opencode-backup-")) {
                        out.put(JSONObject().put("name", f.name).put("bytes", f.length()).put("at", f.lastModified()))
                    }
                }
            }
        } catch (_: Throwable) {
        }
        return out.toString()
    }

    private fun openBackup(name: String): java.io.InputStream? {
        val leaf = name.substringAfterLast('/').substringAfterLast('\\')
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val where = android.provider.MediaStore.Downloads.DISPLAY_NAME + " = ?"
            activity.contentResolver.query(
                android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                arrayOf(android.provider.MediaStore.Downloads._ID), where, arrayOf(leaf), null,
            )?.use { c ->
                if (c.moveToFirst()) {
                    val uri = android.content.ContentUris.withAppendedId(
                        android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, c.getLong(0)
                    )
                    return activity.contentResolver.openInputStream(uri)
                }
            }
            return null
        }
        return backupFile(name)?.inputStream()
    }

    /**
     * Restore from a file the user picked in the system file picker.
     *
     * Android removes an app's MediaStore rows when it is uninstalled, so a
     * backup made before a reinstall cannot be *listed* afterwards — but the
     * file is still in Downloads. Picking it is the reliable way back home.
     */
    @android.webkit.JavascriptInterface
    fun restoreRuntimeFromBase64(name: String, base64: String): String {
        return try {
            val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
            if (bytes.size < 1000) {
                return JSONObject().put("ok", false).put("error", "That file is too small to be a backup").toString()
            }
            val tmp = java.io.File(activity.cacheDir, "picked-" + System.currentTimeMillis() + ".zip")
            tmp.writeBytes(bytes)
            val res = restoreFromStream(tmp.inputStream(), name)
            tmp.delete()
            res
        } catch (t: Throwable) {
            JSONObject().put("ok", false).put("error", t.message ?: "restore failed").toString()
        }
    }

    /**
     * Replace the runtime's data with a backup.
     *
     * The daemon is stopped first so the database file is not open, the current
     * data is moved aside (never deleted), and unsafe entries in the archive are
     * refused.
     */
    @android.webkit.JavascriptInterface
    fun restoreRuntimeBackup(name: String): String {
        return try {
            val safe = name.substringAfterLast('/').substringAfterLast('\\')
            if (!safe.startsWith("opencode-backup-") || !safe.endsWith(".zip")) {
                return JSONObject().put("ok", false).put("error", "That is not a Pocket backup").toString()
            }
            val stream = openBackup(safe)
                ?: return JSONObject().put("ok", false).put("error", "The backup could not be opened").toString()
            restoreFromStream(stream, safe)
        } catch (t: Throwable) {
            JSONObject().put("ok", false).put("error", t.message ?: "restore failed").toString()
        }
    }

    private fun restoreFromStream(input: java.io.InputStream, name: String): String {
        return try {
            activity.startService(
                Intent(activity, OpencodeService::class.java).setAction(OpencodeService.ACTION_STOP)
            )
            RuntimeSupervisor.reset()
            // Stopping the service does not stop the daemon it spawned, and a
            // daemon holding the database open would keep serving the old data.
            EmbeddedRuntime.killAll(activity)
            Thread.sleep(1200) // let the database file be released

            val root = runtimeHome()
            val aside = java.io.File(
                activity.filesDir, "opencode-home.before-restore-" + System.currentTimeMillis()
            )
            if (root.exists() && !root.renameTo(aside)) {
                throw IllegalStateException("the current data could not be moved aside")
            }
            root.mkdirs()
            val rootPath = root.canonicalPath
            var files = 0
            java.util.zip.ZipInputStream(java.io.BufferedInputStream(input)).use { zin ->
                var entry = zin.nextEntry
                while (entry != null) {
                    val target = java.io.File(root, entry.name).canonicalFile
                    if (!target.path.startsWith(rootPath)) {
                        throw IllegalStateException("the backup contains an unsafe path")
                    }
                    if (entry.isDirectory) {
                        target.mkdirs()
                    } else {
                        target.parentFile?.mkdirs()
                        target.outputStream().use { zin.copyTo(it) }
                        files += 1
                    }
                    zin.closeEntry()
                    entry = zin.nextEntry
                }
            }
            JSONObject().put("ok", true).put("files", files).put("keptAside", aside.name).toString()
        } catch (t: Throwable) {
            JSONObject().put("ok", false).put("error", t.message ?: "restore failed").toString()
        }
    }

    /** Bring the runtime back after a restore, and reload the client. */
    @android.webkit.JavascriptInterface
    fun restartAfterRestore() {
        activity.startService(Intent(activity, OpencodeService::class.java))
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            activity.recreate()
        }, 2000)
    }

    // ---- APK updates (GitHub releases) -------------------------------------
    @Volatile private var pendingRelease: UpdateManager.Release? = null
    @Volatile private var pendingApk: java.io.File? = null
    @Volatile private var updateBusy = false
    @Volatile private var updateStatus = ""

    @android.webkit.JavascriptInterface
    fun updateState(): String {
        val prefs = activity.getSharedPreferences("pocket", Context.MODE_PRIVATE)
        return org.json.JSONObject()
            .put("installed", UpdateManager.installedVersion(activity))
            .put("busy", updateBusy)
            .put("progress", UpdateManager.downloadProgress)
            .put("status", updateStatus)
            .put("lastCheck", prefs.getString("lastUpdateCheck", "") ?: "")
            .put("latest", pendingRelease?.version ?: "")
            .put("notes", pendingRelease?.notes ?: "")
            .toString()
    }

    @android.webkit.JavascriptInterface
    fun checkApkUpdate(): String {
        val state = UpdateManager.check(activity)
        pendingRelease = state.latest
        updateStatus = state.message
        activity.getSharedPreferences("pocket", Context.MODE_PRIVATE).edit()
            .putString("lastUpdateCheck", java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.US).format(java.util.Date()))
            .apply()
        return org.json.JSONObject()
            .put("installed", state.currentVersion)
            .put("latest", state.latest?.version ?: "")
            .put("available", state.updateAvailable)
            .put("notes", state.latest?.notes ?: "")
            .put("message", state.message)
            .toString()
    }

    @android.webkit.JavascriptInterface
    fun downloadApkUpdate(): Boolean {
        val release = pendingRelease ?: return false
        if (updateBusy) return false
        updateBusy = true
        updateStatus = "Downloading…"
        Thread {
            val file = UpdateManager.download(activity, release)
            pendingApk = file
            updateBusy = false
            updateStatus = if (file != null) "Downloaded and verified" else "Download failed or failed verification"
        }.start()
        return true
    }

    @android.webkit.JavascriptInterface
    fun installApkUpdate(): Boolean {
        val apk = pendingApk ?: return false
        if (!UpdateManager.sameSigner(activity, apk)) {
            updateStatus = "Signature does not match this installation"
            return false
        }
        return try {
            activity.runOnUiThread { UpdateManager.install(activity, apk) }
            updateStatus = "Opening the system installer"
            true
        } catch (t: Throwable) {
            updateStatus = "Could not open the installer: ${t.message}"
            false
        }
    }

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
        // Switching runtimes must not delete history, sessions or credentials.
        // Each runtime keeps its own store; the local history copy stays.
        prefs.edit().putString("runtimeMode", mode).putString("lastRuntimeMode", mode).apply()
        RuntimeSupervisor.reset()
    }
}
