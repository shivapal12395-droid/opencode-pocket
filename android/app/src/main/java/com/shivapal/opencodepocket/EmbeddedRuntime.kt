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
    private const val BUNDLE_SHA = "2afda3e355f54bef72e3a0eaa3bd316702eb7c4658f27a2a393a47b7c4c618d6"

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
        val nativeLib = context.applicationInfo.nativeLibraryDir
        val rt = runtimeDir(context)
        val rootfs = File(rt, "rootfs")
        val workspace = File(rt, "workspace").also { it.mkdirs() }
        val tmp = File(context.filesDir, "tmp").also { it.mkdirs() }
        val argv = arrayOf(
            "$nativeLib/libproot.so",
            "-r", rootfs.absolutePath,
            "-b", "/dev",
            "-b", "/proc",
            "-b", "${workspace.absolutePath}:/workspace",
            "-w", "/workspace",
            "/usr/local/bin/opencode", "serve",
            "--hostname", "127.0.0.1", "--port", port.toString(),
        )
        val env = arrayOf(
            "LD_LIBRARY_PATH=$nativeLib",
            "PROOT_TMP_DIR=${tmp.absolutePath}",
            "PROOT_NO_SECCOMP=1",
            "HOME=/root",
            "PATH=/usr/local/bin:/usr/bin:/bin",
            "TERM=xterm",
        )
        note(context, "launch: ${argv.joinToString(" ")}")
        val h = NativeLauncher.start(argv, env)
        note(context, "handle=$h")
        return h
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
                val h = start(context)
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
                stop(h)

                // Fallback experiment: invoke the musl loader directly. The
                // loader is itself an ET_DYN with no PT_INTERP, so Android can
                // execute it from app storage without proot's ptrace.
                val rt = runtimeDir(context)
                val loader = File(rt, "rootfs/lib/ld-musl-aarch64.so.1")
                val bin = File(rt, "rootfs/usr/local/bin/opencode")
                if (loader.exists() && bin.exists()) {
                    val argv = arrayOf(loader.absolutePath, bin.absolutePath, "--version")
                    val env = arrayOf("LD_LIBRARY_PATH=" + File(rt, "rootfs/lib").absolutePath)
                    val h2 = NativeLauncher.start(argv, env)
                    note(context, "loader probe handle=$h2 out=" + NativeLauncher.read(h2, 2500).take(400))
                    note(context, "loader probe exit=" + NativeLauncher.waitFor(h2))
                }
            } catch (t: Throwable) {
                note(context, "probe failed: ${t.javaClass.simpleName}: ${t.message}")
            }
        }.start()
    }
}
