package com.shivapal.opencodepocket

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Updates the Pocket APK from this repository's GitHub releases.
 *
 * Two independent checks are enforced before the system installer is asked to
 * run: the file must match the published SHA-256 digest, and its signing
 * certificate must match the installed app. A bad download is deleted and the
 * current installation is left untouched.
 */
object UpdateManager {
    private const val TAG = "Pocket.Update"
    const val REPO = "shivapal12395-droid/opencode-pocket"
    private const val API = "https://api.github.com/repos/$REPO/releases?per_page=20"

    data class Release(
        val tag: String,
        val name: String,
        val notes: String,
        val version: String,
        val apkUrl: String?,
        val digest: String?,
        val publishedAt: String?,
        val prerelease: Boolean,
    )

    data class State(
        val currentVersion: String,
        val latest: Release?,
        val updateAvailable: Boolean,
        val message: String,
    )

    @Volatile
    var downloadProgress: Int = 0
        private set

    @Volatile
    var downloaded: File? = null
        private set

    fun installedVersion(context: Context): String = try {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"
    } catch (_: Throwable) {
        "?"
    }

    fun installedVersionCode(context: Context): Long = try {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    } catch (_: Throwable) {
        0L
    }

    /** Parse "1.2.3" or "v1.2.3" into a comparable list of numbers. */
    private fun parts(v: String): List<Int> =
        v.trim().removePrefix("v").split(".", "-").map { it.toIntOrNull() ?: 0 }

    fun isNewer(candidate: String, installed: String): Boolean {
        val a = parts(candidate)
        val b = parts(installed)
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    fun check(context: Context): State {
        val current = installedVersion(context)
        return try {
            val conn = URL(API).openConnection() as HttpURLConnection
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            conn.setRequestProperty("User-Agent", "opencode-pocket")
            conn.connectTimeout = 8000
            conn.readTimeout = 12000
            val body = conn.inputStream.bufferedReader().readText()
            conn.disconnect()
            val arr = org.json.JSONArray(body)
            var best: Release? = null
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                if (o.optBoolean("draft")) continue
                val tag = o.optString("tag_name")
                // The runtime bundle is not an APK release.
                if (!tag.startsWith("v") && !o.optString("name").startsWith("Pocket")) continue
                val assets = o.optJSONArray("assets") ?: continue
                var apkUrl: String? = null
                var digest: String? = null
                for (a in 0 until assets.length()) {
                    val asset = assets.getJSONObject(a)
                    val name = asset.optString("name")
                    if (name.endsWith(".apk", true)) {
                        apkUrl = asset.optString("browser_download_url")
                        digest = asset.optString("digest").takeIf { it.isNotBlank() }
                        break
                    }
                }
                if (apkUrl == null) continue
                val release = Release(
                    tag = tag,
                    name = o.optString("name", tag),
                    notes = o.optString("body", ""),
                    version = tag.removePrefix("v"),
                    apkUrl = apkUrl,
                    digest = digest,
                    publishedAt = o.optString("published_at"),
                    prerelease = o.optBoolean("prerelease"),
                )
                if (best == null || isNewer(release.version, best.version)) best = release
            }
            val available = best != null && isNewer(best.version, current)
            State(current, best, available, if (available) "Update available" else "You are up to date")
        } catch (t: Throwable) {
            Log.w(TAG, "check failed", t)
            State(current, null, false, "Could not reach GitHub: ${t.message}")
        }
    }

    /** Downloads and verifies the release APK. Blocking; call off the UI thread. */
    fun download(context: Context, release: Release): File? {
        val url = release.apkUrl ?: return null
        val dir = File(context.filesDir, "updates").also { it.mkdirs() }
        val out = File(dir, "pocket-${release.version}.apk")
        downloadProgress = 0
        return try {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = true
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.inputStream.use { input ->
                FileOutputStream(out).use { fos ->
                    val buf = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        fos.write(buf, 0, n)
                        total += n
                        downloadProgress = ((total * 100) / maxOf(conn.contentLengthLong, 1L)).toInt().coerceIn(0, 100)
                    }
                }
            }
            val expected = release.digest
            if (!expected.isNullOrBlank()) {
                val actual = "sha256:" + sha256(out)
                if (!actual.equals(expected, ignoreCase = true)) {
                    Log.w(TAG, "digest mismatch expected=$expected actual=$actual")
                    out.delete()
                    return null
                }
            }
            if (!sameSigner(context, out)) {
                Log.w(TAG, "signer mismatch")
                out.delete()
                return null
            }
            downloaded = out
            out
        } catch (t: Throwable) {
            Log.w(TAG, "download failed", t)
            out.delete()
            null
        }
    }

    /** True when the new APK is signed by the same certificate as this app. */
    fun sameSigner(context: Context, apk: File): Boolean {
        return try {
            val pm = context.packageManager
            val incoming = if (Build.VERSION.SDK_INT >= 28) {
                pm.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
                    ?.signingInfo?.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageArchiveInfo(apk.absolutePath, PackageManager.GET_SIGNATURES)
                    ?.signatures
            } ?: return false
            val installed = if (Build.VERSION.SDK_INT >= 28) {
                pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
                    .signingInfo?.apkContentsSigners
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES).signatures
            } ?: return false
            val a = incoming.map { sha256(it.toByteArray()) }.sorted()
            val b = installed.map { sha256(it.toByteArray()) }.sorted()
            a == b
        } catch (t: Throwable) {
            Log.w(TAG, "signer compare failed", t)
            false
        }
    }

    /** Opens Android's package installer for the verified APK. */
    fun install(context: Context, apk: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}