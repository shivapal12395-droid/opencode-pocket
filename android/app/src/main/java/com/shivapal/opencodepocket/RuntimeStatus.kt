package com.shivapal.opencodepocket

/**
 * What the daemon is doing right now, for the launch screen.
 *
 * A first run downloads a 124 MB runtime, which used to look like a frozen
 * black screen with one static line of text. The supervisor and the installer
 * publish stages here and [MainActivity] renders them while it waits.
 */
object RuntimeStatus {
    @Volatile
    var message: String = "Starting OpenCode..."
        private set

    /** 0..100 for a known-progress stage, -1 for "no idea, show a spinner". */
    @Volatile
    var percent: Int = -1
        private set

    fun set(message: String, percent: Int = -1) {
        this.message = message
        this.percent = percent
    }

    fun reset() = set("Starting OpenCode...")
}