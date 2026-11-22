package com.swissmarley.homeblockbuster.data

import android.media.MediaCodecList
import android.media.MediaFormat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val status: Int, message: String) : Exception(message) {
    companion object {
        val UNREACHABLE = ApiException(
            0,
            "Can't reach this Home Blockbuster server. Check the address and that your phone is on the same network.",
        )
    }
}

val HbJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
}

/** Talks to one Home Blockbuster server. Session cookies are handled by hand so every saved server keeps its own. */
class ApiClient(
    val baseUrl: String,
    private val accountKey: String,
    private val store: SecureStore?,
) {
    @Volatile
    private var _token: String? = store?.get(accountKey)

    /** Called on 401 for authenticated endpoints. */
    var onUnauthorized: (() -> Unit)? = null

    var token: String?
        get() = _token
        set(value) {
            _token = value
            store?.set(accountKey, value)
        }

    /** Headers needed for any request to this server (API, images, video). */
    val authHeaders: Map<String, String>
        get() = buildMap {
            put("X-Requested-With", "HomeBlockbuster")
            token?.let { put("Cookie", "$SESSION_COOKIE=$it") }
        }

    /** Resolves a server-relative URL such as "/api/img?u=…". */
    fun url(path: String): String {
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        val base = baseUrl.trimEnd('/')
        return base + if (path.startsWith("/")) path else "/$path"
    }

    // region Core

    private suspend fun <T> send(
        method: String,
        path: String,
        serializer: KSerializer<T>,
        query: Map<String, String?> = emptyMap(),
        body: JsonObject? = null,
        timeoutSeconds: Long? = null,
    ): T {
        val parsed: HttpUrl = url(path).toHttpUrlOrNull() ?: throw ApiException(0, "Invalid server address.")
        val httpUrl = parsed.newBuilder().apply {
            query.forEach { (k, v) -> if (v != null) addQueryParameter(k, v) }
        }.build()
        val builder = Request.Builder().url(httpUrl)
        authHeaders.forEach { (k, v) -> builder.header(k, v) }
        val requestBody = body?.toString()?.toRequestBody(JSON)
        builder.method(method, requestBody ?: if (method == "POST" || method == "PUT") ByteArray(0).toRequestBody(null) else null)
        val client = if (timeoutSeconds != null) {
            http.newBuilder().callTimeout(timeoutSeconds, TimeUnit.SECONDS).build()
        } else http

        val response = try {
            client.newCall(builder.build()).await()
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw ApiException.UNREACHABLE
        }
        return withContext(Dispatchers.IO) {
            response.use { res ->
                captureSession(res)
                val text = res.body?.string().orEmpty()
                ensureActive()
                if (res.code == 401 && !path.startsWith("/api/auth/")) onUnauthorized?.invoke()
                if (!res.isSuccessful) {
                    var message = res.message.ifBlank { "Error ${res.code}" }
                    val fromJson = runCatching { HbJson.decodeFromString(ErrorResponse.serializer(), text).error }.getOrNull()
                    if (fromJson != null) message = fromJson
                    else if (text.isNotEmpty() && text.length < 300 && !text.contains("<")) message = text
                    throw ApiException(res.code, message)
                }
                if (text.isBlank() && serializer == OkResponse.serializer()) {
                    @Suppress("UNCHECKED_CAST")
                    return@use OkResponse(true) as T
                }
                try {
                    HbJson.decodeFromString(serializer, text)
                } catch (e: Exception) {
                    throw ApiException(res.code, "This server sent a response the app doesn't understand. Is it a Home Blockbuster server?")
                }
            }
        }
    }

    private fun captureSession(response: Response) {
        for (header in response.headers("Set-Cookie")) {
            val pair = header.substringBefore(';')
            val name = pair.substringBefore('=').trim()
            if (name == SESSION_COOKIE) {
                val value = pair.substringAfter('=', "").trim()
                token = value.ifEmpty { null }
            }
        }
    }

    // endregion

    // region Endpoints

    suspend fun health(): HealthInfo = send("GET", "/api/health", HealthInfo.serializer(), timeoutSeconds = 8)
    suspend fun authStatus(): AuthStatus = send("GET", "/api/auth/status", AuthStatus.serializer(), timeoutSeconds = 8)

    suspend fun login(password: String) {
        send("POST", "/api/auth/login", OkResponse.serializer(), body = JsonObject(mapOf("password" to JsonPrimitive(password))))
    }

    suspend fun logout() {
        runCatching { send("POST", "/api/auth/logout", OkResponse.serializer()) }
        token = null
    }

    suspend fun titles(profileId: String?): List<TitleSummary> =
        send("GET", "/api/titles", serializer(), mapOf("profile" to profileId), timeoutSeconds = 40)

    suspend fun title(id: String, profileId: String?): TitleDetail =
        send("GET", "/api/titles/${enc(id)}", TitleDetail.serializer(), mapOf("profile" to profileId))

    suspend fun profiles(): List<ProfileDTO> = send("GET", "/api/profiles", serializer())

    suspend fun createProfile(name: String, avatar: String, kids: Boolean): ProfileDTO =
        send(
            "POST", "/api/profiles", ProfileDTO.serializer(),
            body = JsonObject(mapOf("name" to JsonPrimitive(name), "avatar" to JsonPrimitive(avatar), "kids" to JsonPrimitive(kids))),
        )

    data class ProfileUpdate(
        val name: String,
        val avatar: String,
        val kids: Boolean,
        val autoplayNext: Boolean,
        val autoplayPreviews: Boolean,
        val subtitleLang: String?,
    )

    suspend fun updateProfile(id: String, p: ProfileUpdate): ProfileDTO =
        send(
            "PUT", "/api/profiles/${enc(id)}", ProfileDTO.serializer(),
            body = JsonObject(
                mapOf(
                    "name" to JsonPrimitive(p.name),
                    "avatar" to JsonPrimitive(p.avatar),
                    "kids" to JsonPrimitive(p.kids),
                    "autoplayNext" to JsonPrimitive(p.autoplayNext),
                    "autoplayPreviews" to JsonPrimitive(p.autoplayPreviews),
                    // Explicit null clears it.
                    "subtitleLang" to (p.subtitleLang?.let { JsonPrimitive(it) } ?: JsonNull),
                )
            ),
        )

    suspend fun deleteProfile(id: String) {
        send("DELETE", "/api/profiles/${enc(id)}", OkResponse.serializer())
    }

    suspend fun profileState(id: String): ProfileState = send("GET", "/api/profiles/${enc(id)}/state", ProfileState.serializer())
    suspend fun continueWatching(id: String): List<ContinueItem> = send("GET", "/api/profiles/${enc(id)}/continue", serializer())

    suspend fun addToList(profileId: String, titleId: String): ProfileState =
        send("PUT", "/api/profiles/${enc(profileId)}/list/${enc(titleId)}", ProfileState.serializer())

    suspend fun removeFromList(profileId: String, titleId: String): ProfileState =
        send("DELETE", "/api/profiles/${enc(profileId)}/list/${enc(titleId)}", ProfileState.serializer())

    suspend fun rate(profileId: String, titleId: String, rating: Int): ProfileState =
        send(
            "PUT", "/api/profiles/${enc(profileId)}/ratings/${enc(titleId)}", ProfileState.serializer(),
            body = JsonObject(mapOf("rating" to JsonPrimitive(rating))),
        )

    suspend fun hideContinue(profileId: String, titleId: String): ProfileState =
        send("DELETE", "/api/profiles/${enc(profileId)}/continue/${enc(titleId)}", ProfileState.serializer())

    suspend fun progress(profileId: String, fileId: String, position: Double, duration: Double): ProgressEntry =
        send(
            "POST", "/api/profiles/${enc(profileId)}/progress", ProgressEntry.serializer(),
            body = JsonObject(
                mapOf("fileId" to JsonPrimitive(fileId), "position" to JsonPrimitive(position), "duration" to JsonPrimitive(duration))
            ),
        )

    suspend fun playback(fileId: String, profileId: String?, audio: Int? = null, force: Boolean = false): PlaybackInfo =
        send(
            "GET", "/api/playback/${enc(fileId)}", PlaybackInfo.serializer(),
            mapOf(
                "profile" to profileId,
                "caps" to deviceCaps,
                "audio" to audio?.toString(),
                "force" to if (force) "1" else null,
            ),
        )

    suspend fun keyframe(fileId: String, at: Double): Double =
        send(
            "GET", "/api/stream/${enc(fileId)}/keyframe", KeyframeResponse.serializer(),
            mapOf("t" to String.format(Locale.US, "%.2f", at)),
        ).t

    suspend fun subtitles(fileId: String, subId: String): List<SubtitleCue> =
        send("GET", "/api/subtitles/${enc(fileId)}/${enc(subId)}", SubtitleResponse.serializer(), timeoutSeconds = 60).cues

    // endregion

    companion object {
        const val SESSION_COOKIE = "hb_session"
        private val JSON = "application/json".toMediaType()

        /** Shared connection pool for every server and for artwork. Cookies are never stored by OkHttp. */
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .build()

        /**
         * For video. No overall call limit (a direct-play stream is one long request), and a generous read
         * timeout because the server holds the first HLS playlist request until ffmpeg has written a segment.
         */
        val mediaHttp: OkHttpClient = http.newBuilder()
            .callTimeout(0, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()

        private fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")

        /**
         * What this phone decodes. ExoPlayer reads MP4, MKV and WebM itself, so those are played directly
         * whenever the codecs inside are supported; anything else is remuxed or converted by the server.
         */
        val deviceCaps: String by lazy {
            val decoders = runCatching {
                MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
                    .filter { !it.isEncoder }
                    .flatMap { it.supportedTypes.map(String::lowercase) }
                    .toSet()
            }.getOrDefault(emptySet())
            val caps = mutableListOf("h264", "aac", "mp3", "mp4", "mkv", "webm")
            if (MediaFormat.MIMETYPE_AUDIO_OPUS in decoders) caps += "opus"
            if (MediaFormat.MIMETYPE_AUDIO_VORBIS in decoders) caps += "vorbis"
            if (MediaFormat.MIMETYPE_AUDIO_FLAC in decoders) caps += "flac"
            if (MediaFormat.MIMETYPE_VIDEO_HEVC in decoders) caps += "hevc"
            if (MediaFormat.MIMETYPE_VIDEO_VP9 in decoders) caps += "vp9"
            if (MediaFormat.MIMETYPE_VIDEO_VP8 in decoders) caps += "vp8"
            if ("video/av01" in decoders) caps += "av1"
            if (MediaFormat.MIMETYPE_AUDIO_AC3 in decoders) caps += "ac3"
            if (MediaFormat.MIMETYPE_AUDIO_EAC3 in decoders) caps += "eac3"
            caps.joinToString(",")
        }
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) = cont.resume(response)
        override fun onFailure(call: Call, e: IOException) {
            if (!cont.isCancelled) cont.resumeWithException(e)
        }
    })
    cont.invokeOnCancellation { runCatching { cancel() } }
}
