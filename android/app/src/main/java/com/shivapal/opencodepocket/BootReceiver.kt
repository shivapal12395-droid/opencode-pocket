package com.shivapal.opencodepocket

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Brings the local server back after a reboot or an app update. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            -> ContextCompat.startForegroundServiceCompat(context, Intent(context, OpencodeService::class.java))
        }
    }
}

/** Helper to keep the receiver readable across API levels. */
private object ContextCompat {
    fun startForegroundServiceCompat(context: Context, intent: Intent) {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }
}
