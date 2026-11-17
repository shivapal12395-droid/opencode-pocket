package com.shivapal.opencodepocket

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Keeps the local OpenCode daemon alive and starts it through Termux's
 * RUN_COMMAND intent. The daemon itself runs in the user's Debian proot — this
 * service never tries to reimplement or bundle it.
 *
 * Android does not guarantee permanent background execution; battery
 * optimisation must be disabled for this app (documented in the README). The
 * foreground notification is what makes long-running turns reliable.
 */
class OpencodeService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            isRunning = false
            return START_NOT_STICKY
        }

        isRunning = true
        startForeground(NOTIF_ID, notification(getString(R.string.notif_title), getString(R.string.notif_starting)))
        startOpencode()
        // START_STICKY: if the system kills us, come back and check whether the
        // daemon is still up (start.sh is idempotent).
        return START_STICKY
    }

    private fun startOpencode() {
        if (!hasRunCommandPermission()) {
            updateNotification(
                "Grant Termux access",
                "Open Termux → Settings → Allow external commands, then reopen Pocket.",
            )
            return
        }

        val intent = Intent("com.termux.RUN_COMMAND").apply {
            setClassName(TERMUX_PKG, "com.termux.app.RunCommandService")
            putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_BASH)
            putExtra(
                "com.termux.RUN_COMMAND_ARGUMENTS",
                arrayOf("-lc", "cd $POCKET_DIR && POCKET_NATIVE=1 bash ./start.sh"),
            )
            putExtra("com.termux.RUN_COMMAND_WORKDIR", POCKET_DIR)
            putExtra("com.termux.RUN_COMMAND_BACKGROUND", true)
            putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
        }
        try {
            startService(intent)
            updateNotification(getString(R.string.notif_title), getString(R.string.notif_running))
        } catch (e: Exception) {
            Log.w(TAG, "could not start OpenCode via Termux", e)
            updateNotification(
                "Could not start OpenCode",
                "Is Termux installed with external commands enabled?",
            )
        }
    }

    private fun hasRunCommandPermission(): Boolean =
        checkSelfPermission("com.termux.permission.RUN_COMMAND") == PackageManager.PERMISSION_GRANTED

    private fun notification(title: String, body: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, OpencodeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, PocketApp.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(body)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_delete, "Stop", stop)
            .build()
    }

    private fun updateNotification(title: String, body: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification(title, body))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isRunning = false
        super.onDestroy()
    }

    companion object {
        private const val TAG = "Pocket.Service"
        private const val NOTIF_ID = 1001
        const val ACTION_STOP = "com.shivapal.opencodepocket.STOP"

        @Volatile
        var isRunning: Boolean = false
            private set

        private const val TERMUX_PKG = "com.termux"
        private const val TERMUX_HOME = "/data/data/com.termux/files/home"
        private const val POCKET_DIR = "$TERMUX_HOME/opencode-pocket"
        private const val TERMUX_BASH = "/data/data/com.termux/files/usr/bin/bash"
    }
}
