package com.shivapal.opencodepocket

import android.content.Context
import android.util.Log

/**
 * One owner for the OpenCode daemon.
 *
 * The Activity never starts a process directly; it asks the supervisor and
 * waits. The supervisor reuses a healthy daemon, starts only missing services,
 * and records the port/secret in one place. The foreground service calls
 * [ensure] so a daemon also starts on boot, and it keeps the process alive.
 */
object RuntimeSupervisor {
    private const val TAG = "Pocket.Supervisor"
    const val EMBEDDED_PORT = 4098
    const val TERMUX_PORT = 4096

    data class Live(val port: Int, val secret: String, val mode: String)

    @Volatile
    private var current: Live? = null

    @Volatile
    var lastError: String? = null
        private set

    val snapshot: Live? get() = current

    fun mode(context: Context): String =
        context.getSharedPreferences("pocket", Context.MODE_PRIVATE)
            .getString("runtimeMode", "embedded") ?: "embedded"

    @Synchronized
    fun ensure(context: Context, allowStart: Boolean = true): Live? {
        val prefs = context.getSharedPreferences("pocket", Context.MODE_PRIVATE)
        val savedSecret = prefs.getString("secret", "") ?: ""
        val mode = mode(context)

        // Reuse anything already healthy, whichever mode it belongs to.
        current?.let { live ->
            if (EmbeddedRuntime.healthy(live.port, live.secret)) {
                Log.d(TAG, "reusing ${live.port}")
                return live
            }
        }

        if (mode == "embedded") {
            if (!allowStart) {
                lastError = "Runtime not started yet"
                return null
            }
            val cred = EmbeddedRuntime.ensure(context, EMBEDDED_PORT)
            if (cred == null) {
                lastError = "OpenCode did not become ready"
                return null
            }
            prefs.edit()
                .putString("base", "http://127.0.0.1:${cred.port}")
                .putString("secret", cred.secret)
                .apply()
            val live = Live(cred.port, cred.secret, "embedded")
            current = live
            lastError = null
            return live
        }

        // Termux mode: the daemon is started by the service through Termux; the
        // supervisor only validates that it is actually answering.
        if (EmbeddedRuntime.healthy(TERMUX_PORT, savedSecret)) {
            val live = Live(TERMUX_PORT, savedSecret, "termux")
            current = live
            lastError = null
            return live
        }
        if (!allowStart) {
            lastError = "Termux server is not running"
            return null
        }
        lastError = "Waiting for the Termux server"
        return null
    }

    fun remember(live: Live) {
        current = live
    }

    fun reset() {
        current = null
    }
}