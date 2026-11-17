package com.shivapal.opencodepocket

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class PocketApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notif_channel),
                NotificationManager.IMPORTANCE_LOW, // silent: it is a status notification
            ).apply {
                description = "Keeps the local OpenCode server alive"
                setShowBadge(false)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_ID = "opencode-pocket-service"
    }
}
