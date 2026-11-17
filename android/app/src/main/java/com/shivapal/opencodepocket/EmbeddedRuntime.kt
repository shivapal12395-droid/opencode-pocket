package com.shivapal.opencodepocket

import android.content.Context
import android.util.Log
import java.io.File
import java.io.BufferedInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * The self-contained runtime: a musl rootfs with OpenCode inside, driven by
 * the bundled proot executable (packaged as libproot.so so Android allows it
 * to run). The rootfs archive is downloaded once and verified by SHA-256.
 *
 * Kept behind a probe marker while it is being validated on device; it does
 * not touch the default Termux path.
 */
object EmbeddedRuntime {
    private const val TAG = "Pocket.Embedded"
    private const val BUNDLE_URL =
        "https://github.com/shivapal12395-droid/opencode-pocket/releases/download/runtime-v2.3.0-r1/runtime.tar.gz"
    private const val BUNDLE_SHA = "bb3a0a60f4be815909c6c43d1331b84a53e76b956f871cab04f4a3b6ee63e796"

    private fun note(context: Context, line: String) {
        Log.d(TAG, line)
        try {
            File(context.filesDir, "embedded-runtime.log").appendText(line + "\n")
        } catch (_: Throwable) {
        }
    }

    fun runtimeDir(context: Context) = File(context.filesDir, "runtime")
    fun installed(context: Context): Boolean =
        File(runtimeDir(context), "rootfs/usr/local/bin/opencode").exists()

    /** A TCP connect is only "something is listening", not "OpenCode is ready". */
    fun portOpen(port: Int): Boolean = try {
        java.net.Socket().use { it.connect(java.net.InetSocketAddress("127.0.0.1", port), 400) }
        true
    } catch (_: Throwable) {
        false
    }

    fun healthy(port: Int, secret: String): Boolean = try {
        val conn = URL("http://127.0.0.1:$port/api/info").openConnection() as HttpURLConnection
        conn.connectTimeout = 1200
        conn.readTimeout = 1500
        if (secret.isNotEmpty()) {
            val token = android.util.Base64.encodeToString("opencode:$secret".toByteArray(), android.util.Base64.NO_WRAP)
            conn.setRequestProperty("Authorization", "Basic $token")
        }
        val ok = conn.responseCode in 200..299
        conn.disconnect()
        ok
    } catch (_: Throwable) {
        false
    }

    /**
     * Reuse a daemon that is already running, otherwise start one on the first
     * free port. Starting a second process on a busy port used to time out and
     * make a reopened app look broken; this is the fix for that.
     */
    fun ensure(context: Context, preferred: Int = 4098): Credentials? {
        val secret = context.getSharedPreferences("pocket", Context.MODE_PRIVATE)
            .getString("secret", "") ?: ""
        if (portOpen(preferred)) {
            if (healthy(preferred, secret)) {
                note(context, "reusing healthy daemon on $preferred")
                return Credentials(preferred, secret)
            }
            note(context, "port $preferred is busy but unhealthy; looking for a free port")
            for (p in preferred + 1..preferred + 4) {
                if (!portOpen(p)) return startAndWait(context, p)
            }
            note(context, "no free port near $preferred")
            return null
        }
        return startAndWait(context, preferred)
    }

    /** Download + verify + unpack. Returns true when the runtime is ready. */
    fun install(context: Context): Boolean {
        if (installed(context)) return true
        val tar = File(context.filesDir, "runtime.tar.gz")
        try {
            if (!tar.exists() || sha256(tar) != BUNDLE_SHA) {
                note(context, "downloading $BUNDLE_URL")
                val conn = URL(BUNDLE_URL).openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = true
                conn.connectTimeout = 20_000
                conn.readTimeout = 60_000
                conn.inputStream.use { input ->
                    tar.outputStream().use { out ->
                        val buf = ByteArray(64 * 1024)
                        var total = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            total += n
                        }
                        note(context, "downloaded $total bytes")
                    }
                }
            }
            val digest = sha256(tar)
            if (digest != BUNDLE_SHA) {
                note(context, "SHA mismatch: $digest")
                tar.delete()
                return false
            }
            note(context, "SHA verified")
            val x = ProcessBuilder("/system/bin/tar", "-xzf", tar.absolutePath, "-C", context.filesDir.absolutePath)
                .redirectErrorStream(true).start()
            val xo = x.inputStream.bufferedReader().readText()
            note(context, "extract exit=${x.waitFor()} $xo".take(600))
            val c = ProcessBuilder("/system/bin/chmod", "-R", "755", runtimeDir(context).absolutePath)
                .redirectErrorStream(true).start()
            note(context, "chmod exit=${c.waitFor()}")
            return installed(context)
        } catch (t: Throwable) {
            note(context, "install failed: ${t.javaClass.simpleName}: ${t.message}")
            return false
        }
    }

    fun start(context: Context, port: Int = 4096): Long {
        // Proot's ptrace-based guest exec is unreliable for a third-party app.
        // The musl loader itself is an ET_DYN with no PT_INTERP, so Android can
        // execute it directly from app storage (targetSdk 28). Invoking it with
        // the binary as its argument is enough to start OpenCode.
        val rt = runtimeDir(context)
        val rootfs = File(rt, "rootfs")
        val loader = File(rootfs, "lib/ld-musl-aarch64.so.1")
        val bin = File(rootfs, "usr/local/bin/opencode")
        val home = File(context.filesDir, "opencode-home").also { it.mkdirs() }
        File(home, "workspace").mkdirs()
        val data = File(home, ".local/share").also { it.mkdirs() }
        val cache = File(home, ".cache").also { it.mkdirs() }
        val config = File(home, ".config").also { it.mkdirs() }
        val state = File(home, ".local/state").also { it.mkdirs() }
        val tmp = File(context.filesDir, "tmp").also { it.mkdirs() }
        val libPath = listOf(
            File(rootfs, "lib").absolutePath,
            File(rootfs, "usr/lib").absolutePath,
        ).joinToString(":")
        val argv = arrayOf(
            loader.absolutePath,
            bin.absolutePath,
            "serve", "--hostname", "127.0.0.1", "--port", port.toString(),
        )
        val env = arrayOf(
            "LD_LIBRARY_PATH=$libPath",
            "HOME=${home.absolutePath}",
            "XDG_DATA_HOME=${data.absolutePath}",
            "XDG_CACHE_HOME=${cache.absolutePath}",
            "XDG_CONFIG_HOME=${config.absolutePath}",
            "XDG_STATE_HOME=${state.absolutePath}",
            "TMPDIR=${tmp.absolutePath}",
            "PATH=/usr/local/bin:/usr/bin:/bin",
            "TERM=xterm",
        )
        note(context, "launch: ${argv.joinToString(" ")}")
        val h = NativeLauncher.start(argv, env, home.absolutePath)
        note(context, "handle=$h")
        return h
    }

    data class Credentials(val port: Int, val secret: String)

    /** Start the bundled daemon and wait until it prints its password. */
    fun startAndWait(context: Context, port: Int = 4098, timeoutMs: Int = 45_000): Credentials? {
        if (!install(context)) return null
        for (candidate in port..port + 2) {
            if (portOpen(candidate)) continue
            note(context, "starting daemon on $candidate")
            val h = start(context, candidate)
            val deadline = System.currentTimeMillis() + timeoutMs
            var log = ""
            var password: String? = null
            while (System.currentTimeMillis() < deadline) {
                log += output(h, 400)
                val m = Regex("server password\\s+(\\S+)").find(log)
                if (m != null) { password = m.groupValues[1]; break }
                if (!NativeLauncher.running(h)) break
            }
            if (password != null && healthy(candidate, password!!)) {
                note(context, "daemon ready on $candidate")
                return Credentials(candidate, password!!)
            }
            note(context, "daemon on $candidate failed: ${log.take(300)}")
            stop(h)
            // EADDRINUSE is worth retrying on the next port; anything else is not.
            if (!log.contains("in use", ignoreCase = true)) break
        }
        return null
    }

    /** Read whatever the daemon has printed (the password is on stdout). */
    fun output(handle: Long, timeoutMs: Int = 600): String = NativeLauncher.read(handle, timeoutMs)

    fun stop(handle: Long) = NativeLauncher.stop(handle)
    fun waitFor(handle: Long): Int = NativeLauncher.waitFor(handle)

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        BufferedInputStream(file.inputStream()).use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    /** Device probe: activated by an empty files/PROBE_EMBEDDED marker. */
    fun runProbeIfRequested(context: Context) {
        val marker = File(context.filesDir, "PROBE_EMBEDDED")
        if (!marker.exists()) return
        marker.delete()
        Thread {
            try {
                note(context, "probe start")
                if (!install(context)) {
                    note(context, "probe: install failed")
                    return@Thread
                }
                val h = start(context, 4097)
                var log = ""
                for (i in 0 until 12) {
                    val s = output(h, 1000)
                    if (s.isNotEmpty()) {
                        log += s
                        note(context, "probe output: " + s.take(300))
                    }
                    if (log.contains("server password", ignoreCase = true)) break
                }
                note(context, "probe done; got password=${log.contains("password", true)}")
                note(context, "probe serve log: " + log.take(1500))
                stop(h)
            } catch (t: Throwable) {
                note(context, "probe failed: ${t.javaClass.simpleName}: ${t.message}")
            }
        }.start()
    }
}
