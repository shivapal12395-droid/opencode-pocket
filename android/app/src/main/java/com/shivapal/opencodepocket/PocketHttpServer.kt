package com.shivapal.opencodepocket

import android.content.Context
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * A tiny loopback HTTP server that does two jobs:
 *
 *  1. serves the bundled web client from the APK's assets, and
 *  2. proxies the /api/ and /auth/ paths to the daemon on 127.0.0.1:4096.
 *
 * The proxy is the important part. It makes the WebView's origin (this server)
 * the same origin as the API, so no CORS headers are needed, no password ever
 * sits in a URL passed to untrusted content, and POST bodies / SSE streams pass
 * through untouched. It is the Kotlin equivalent of server.mjs plus a reverse
 * proxy, and it is the only native component the web client depends on.
 */
class PocketHttpServer(
    private val context: Context,
    private val preferredPort: Int = 8099,
    private val upstream: String = "http://127.0.0.1:4096",
) {
    private var server: ServerSocket? = null
    private val pool: ExecutorService = Executors.newCachedThreadPool()
    private val running = AtomicBoolean(false)

    @Volatile
    var boundPort: Int = preferredPort
        private set

    val url: String get() = "http://127.0.0.1:$boundPort"

    /**
     * Bind the first free loopback port. A silent EADDRINUSE used to leave the
     * WebView pointed at whatever else owned 8099 (usually a stale Termux UI
     * server), which is exactly how the app "opened fine once, then broke".
     */
    fun start(): Boolean {
        if (!running.compareAndSet(false, true)) return true
        for (candidate in preferredPort downTo preferredPort - 4) {
            try {
                val socket = ServerSocket()
                socket.reuseAddress = true
                socket.bind(java.net.InetSocketAddress(InetAddress.getByName("127.0.0.1"), candidate), 32)
                server = socket
                boundPort = candidate
                pool.execute { acceptLoop(socket) }
                return true
            } catch (e: IOException) {
                // Try the next port.
            }
        }
        running.set(false)
        return false
    }

    private fun acceptLoop(socket: ServerSocket) {
        while (running.get()) {
            try {
                val client = socket.accept()
                client.soTimeout = 0 // SSE stays open indefinitely
                pool.execute { handleClient(client) }
            } catch (e: SocketTimeoutException) {
                continue
            } catch (e: IOException) {
                if (running.get()) break
            }
        }
    }

    fun stop() {
        running.set(false)
        try {
            server?.close()
        } catch (_: IOException) {
        }
        pool.shutdownNow()
    }

    val isRunning: Boolean get() = running.get()

    companion object {
        @Volatile
        private var shared: PocketHttpServer? = null

        @Volatile
        private var sharedUpstreamPort: Int = -1

        /**
         * The UI server is process-wide. Recreating the Activity must not bind a
         * second socket (which used to silently fall back to a different port
         * and therefore a different browser origin).
         */
        @Synchronized
        fun instance(context: Context, upstreamPort: Int): PocketHttpServer {
            val existing = shared
            if (existing != null && existing.isRunning && sharedUpstreamPort == upstreamPort) return existing
            existing?.stop()
            val server = PocketHttpServer(
                context.applicationContext,
                upstream = "http://127.0.0.1:$upstreamPort",
            )
            server.start()
            shared = server
            sharedUpstreamPort = upstreamPort
            return server
        }
    }

    private fun handleClient(socket: Socket) {
        try {
            socket.use { sock ->
                val input = sock.getInputStream()
                val output = BufferedOutputStream(sock.getOutputStream())

                // Request line: "GET /api/session HTTP/1.1"
                val requestLine = readLine(input) ?: return
                val parts = requestLine.split(" ")
                if (parts.size < 2) {
                    writeStatus(output, 400, "Bad Request")
                    output.flush()
                    return
                }
                val method = parts[0].uppercase(Locale.ROOT)
                val target = parts[1]
                val path = target.substringBefore("?")
                val query = if ('?' in target) target.substringAfter("?") else null

                val headers = LinkedHashMap<String, String>()
                while (true) {
                    val line = readLine(input) ?: break
                    if (line.isEmpty()) break
                    val idx = line.indexOf(':')
                    if (idx > 0) {
                        headers[line.substring(0, idx).trim().lowercase(Locale.ROOT)] =
                            line.substring(idx + 1).trim()
                    }
                }

                // Read a request body when Content-Length is present. The web
                // client sends JSON this way; there are no chunked uploads.
                val length = headers["content-length"]?.toIntOrNull() ?: 0
                val body = if (length > 0) input.readNBytes(length) else ByteArray(0)

                when {
                    path.startsWith("/api/") || path.startsWith("/auth/") ->
                        proxy(output, method, path, query, headers, body)
                    else ->
                        serveAsset(output, path)
                }
                output.flush()
            }
        } catch (_: IOException) {
            // A closed connection is normal (the WebView cancels an SSE stream
            // when a session changes), so it is not an error worth reporting.
        } catch (_: Exception) {
        }
    }

    /* ------------------------------------------------------------- proxy */

    private fun proxy(
        output: OutputStream,
        method: String,
        path: String,
        query: String?,
        headers: Map<String, String>,
        body: ByteArray,
    ) {
        val url = upstream + path + (query?.let { "?$it" } ?: "")
        var connection: HttpURLConnection? = null
        try {
            connection = URL(url).openConnection() as HttpURLConnection
            connection.requestMethod = method
            connection.connectTimeout = 10_000
            connection.readTimeout = 0 // SSE and long shell calls can be quiet
            connection.instanceFollowRedirects = false

            // Forward only the headers that mean something to the API. Never
            // forward Host or Origin — those must describe this loopback hop.
            for (key in listOf("authorization", "content-type", "accept", "x-requested-with")) {
                headers[key]?.let { connection.setRequestProperty(key, it) }
            }
            connection.doOutput = method != "GET" && method != "HEAD"
            if (connection.doOutput) {
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }

            val status = connection.responseCode
            val message = connection.responseMessage ?: "OK"
            writeStatus(output, status, message)

            // Copy content type and caching hints, but never Content-Length or
            // Transfer-Encoding: the response is EOF-delimited (Connection:
            // close), which works for both JSON and an endless SSE stream.
            connection.getHeaderField("content-type")?.let {
                writeHeader(output, "Content-Type", it)
            }
            connection.getHeaderField("cache-control")?.let {
                writeHeader(output, "Cache-Control", it)
            }
            if (connection.getHeaderField("content-type")?.contains("event-stream") == true) {
                writeHeader(output, "Cache-Control", "no-cache")
                writeHeader(output, "X-Accel-Buffering", "no")
            }
            writeHeader(output, "X-Content-Type-Options", "nosniff")
            writeHeader(output, "Connection", "close")
            output.write("\r\n".toByteArray())
            output.flush()

            val stream: InputStream? = try {
                connection.inputStream
            } catch (_: IOException) {
                connection.errorStream // 4xx/5xx still carry a JSON body
            }
            stream?.use { src ->
                val buffer = ByteArray(16 * 1024)
                while (true) {
                    val n = src.read(buffer)
                    if (n < 0) break
                    output.write(buffer, 0, n)
                    output.flush() // essential: SSE deltas must arrive live
                }
            }
        } catch (e: IOException) {
            // Nothing was written yet, or the client is gone. Either way the
            // connection is about to close; a status line would be misleading.
        } finally {
            connection?.disconnect()
        }
    }

    /* ------------------------------------------------------------ assets */

    private fun serveAsset(output: OutputStream, path: String) {
        val clean = path.trimStart('/')
        val assetPath = if (clean.isEmpty() || clean == "index.html") "index.html" else clean
        // decodeURIComponent is already done by WebView; reject traversal.
        if (assetPath.contains("..") || assetPath.startsWith("/")) {
            writeStatus(output, 403, "Forbidden")
            output.write("Forbidden".toByteArray())
            return
        }
        val bytes = try {
            context.assets.open(assetPath).use { it.readBytes() }
        } catch (_: IOException) {
            writeStatus(output, 404, "Not Found")
            output.write("Not found".toByteArray())
            return
        }
        val mime = mimeFor(assetPath)
        writeStatus(output, 200, "OK")
        writeHeader(output, "Content-Type", mime)
        writeHeader(output, "Cache-Control", "no-cache")
        writeHeader(output, "X-Content-Type-Options", "nosniff")
        writeHeader(output, "Content-Length", bytes.size.toString())
        writeHeader(output, "Connection", "close")
        output.write("\r\n".toByteArray())
        output.write(bytes)
    }

    private fun mimeFor(path: String): String = when (path.substringAfterLast('.').lowercase(Locale.ROOT)) {
        "html" -> "text/html; charset=utf-8"
        "js", "mjs" -> "text/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "json" -> "application/json; charset=utf-8"
        "webmanifest" -> "application/manifest+json; charset=utf-8"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "ico" -> "image/x-icon"
        "md" -> "text/markdown; charset=utf-8"
        "txt" -> "text/plain; charset=utf-8"
        "woff2" -> "font/woff2"
        else -> "application/octet-stream"
    }

    /* ------------------------------------------------------------ helpers */

    private fun readLine(input: InputStream): String? {
        val out = ByteArrayOutputStream()
        var b: Int
        while (true) {
            b = input.read()
            if (b == -1) return if (out.size() > 0) out.toString("UTF-8") else null
            if (b == '\n'.code) {
                val s = out.toString("UTF-8")
                return if (s.endsWith("\r")) s.dropLast(1) else s
            }
            out.write(b)
            if (out.size() > 64 * 1024) return null // header too large
        }
    }

    private fun writeStatus(output: OutputStream, code: Int, message: String) {
        output.write("HTTP/1.1 $code $message\r\n".toByteArray())
    }

    private fun writeHeader(output: OutputStream, key: String, value: String) {
        output.write("$key: $value\r\n".toByteArray())
    }
}
