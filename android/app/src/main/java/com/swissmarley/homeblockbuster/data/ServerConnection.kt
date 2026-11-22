package com.swissmarley.homeblockbuster.data

import kotlinx.serialization.Serializable
import java.net.URI
import java.util.UUID

/** A saved Home Blockbuster instance ("Home", "Alex's place"…). The session cookie lives in [SecureStore]. */
@Serializable
data class ServerConnection(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    /** Normalized base URL, e.g. "http://192.168.1.20:8585". */
    val url: String,
    val createdAt: Long = System.currentTimeMillis(),
    val lastUsedAt: Long? = null,
    /** Profile chosen last time on this server. */
    val lastProfileId: String? = null,
    /** Skip "Who's watching?" and open the last profile directly. */
    val rememberProfile: Boolean = false,
    /** Server version seen on the last connection. */
    val version: String? = null,
) {
    val displayHost: String
        get() = runCatching {
            val u = URI(url)
            val host = u.host ?: return url
            if (u.port != -1) "$host:${u.port}" else host
        }.getOrDefault(url)

    val isHttps: Boolean get() = url.startsWith("https")

    companion object {
        /** Accepts "nas.local", "192.168.1.20:8585", "https://media.example.com/" and returns a clean base URL. */
        fun normalize(input: String): String? {
            var text = input.trim()
            if (text.isEmpty()) return null
            val lower = text.lowercase()
            val hadScheme = lower.startsWith("http://") || lower.startsWith("https://")
            if (!hadScheme) text = "http://$text"
            val uri = runCatching { URI(text) }.getOrNull() ?: return null
            val host = uri.host?.takeIf { it.isNotEmpty() } ?: return null
            val scheme = (uri.scheme ?: "http").lowercase()
            // "nas.local" alone means the server's default port; "http://nas.local" means port 80 (e.g. a proxy).
            val port = if (uri.port == -1 && !hadScheme) 8585 else uri.port
            var path = uri.rawPath ?: ""
            while (path.endsWith("/")) path = path.dropLast(1)
            // Users sometimes paste a deep link; keep only a reverse-proxy prefix, never an app route.
            val api = path.indexOf("/api")
            if (api >= 0) path = path.substring(0, api)
            val hostPart = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
            return buildString {
                append(scheme).append("://").append(hostPart)
                if (port != -1) append(':').append(port)
                append(path)
            }
        }
    }
}

/** Per-device playback preferences. */
@Serializable
data class AppPreferences(
    val quality: Quality = Quality.P1080,
    /** Ask the server to convert every video instead of playing files directly. */
    val alwaysConvert: Boolean = false,
    val subtitleSize: Double = 1.0,
) {
    @Serializable
    enum class Quality(val label: String, val maxHeight: Int) {
        ORIGINAL("Best available", 2160),
        P1080("1080p", 1080),
        P720("720p (saves data)", 720),
        P480("480p (lowest data)", 480),
    }
}
