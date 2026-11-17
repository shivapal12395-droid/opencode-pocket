package com.shivapal.opencodepocket

/** Thin JNI wrapper around fork/execve. Output of a child is captured on a
 *  pipe and read with read(), so the WebView never needs a second port. */
object NativeLauncher {
    init {
        System.loadLibrary("pocketlauncher")
    }

    @JvmStatic external fun start(argv: Array<String>, env: Array<String>, workdir: String? = null): Long
    @JvmStatic external fun read(handle: Long, timeoutMs: Int): String
    @JvmStatic external fun waitFor(handle: Long): Int
    @JvmStatic external fun running(handle: Long): Boolean
    @JvmStatic external fun stop(handle: Long)
}
