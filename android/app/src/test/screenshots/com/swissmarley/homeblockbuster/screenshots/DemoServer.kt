package com.swissmarley.homeblockbuster.screenshots

import com.swissmarley.homeblockbuster.data.ContinueItem
import com.swissmarley.homeblockbuster.data.HbJson
import com.swissmarley.homeblockbuster.data.ProfileDTO
import com.swissmarley.homeblockbuster.data.TitleSummary
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import java.io.File

/** A tiny stand-in for the Home Blockbuster server that answers the app's API with [DemoLibrary]. */
class DemoServer(private val artDir: File, private val mainProfileId: String) : AutoCloseable {
    private val server = MockWebServer()

    /** Artwork requests answered so far, to know when the screen has finished loading images. */
    @Volatile
    var artServed = 0
        private set

    val url: String get() = server.url("/").toString().trimEnd('/')

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = handle(request)
        }
        server.start()
    }

    private fun json(text: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(text)

    private fun handle(request: RecordedRequest): MockResponse {
        val path = request.requestUrl?.encodedPath ?: return MockResponse().setResponseCode(400)
        val parts = path.trim('/').split('/')
        val profiles = DemoLibrary.profiles(mainProfileId)
        return when {
            path.startsWith("/art/") -> {
                val file = File(artDir, path.removePrefix("/art/"))
                if (!file.isFile) return MockResponse().setResponseCode(404)
                artServed++
                MockResponse()
                    .setHeader("Content-Type", if (file.name.endsWith(".png")) "image/png" else "image/jpeg")
                    .setBody(Buffer().write(file.readBytes()))
            }
            path == "/api/health" -> json("""{"ok":true,"version":"1.0.0"}""")
            path == "/api/auth/status" -> json("""{"required":false,"authenticated":true}""")
            path == "/api/profiles" -> json(HbJson.encodeToString(ListSerializer(ProfileDTO.serializer()), profiles))
            path == "/api/titles" -> json(HbJson.encodeToString(ListSerializer(TitleSummary.serializer()), DemoLibrary.titles))
            parts.size == 3 && parts[1] == "titles" ->
                DemoLibrary.detail(parts[2])?.let { json(HbJson.encodeToString(com.swissmarley.homeblockbuster.data.TitleDetail.serializer(), it)) }
                    ?: MockResponse().setResponseCode(404)
            parts.size >= 4 && parts[1] == "profiles" && parts[3] == "continue" ->
                json(HbJson.encodeToString(ListSerializer(ContinueItem.serializer()), DemoLibrary.continueItems))
            parts.size >= 4 && parts[1] == "profiles" && parts[3] == "progress" -> json("""{"fileId":"x"}""")
            parts.size >= 4 && parts[1] == "profiles" ->
                json(HbJson.encodeToString(com.swissmarley.homeblockbuster.data.ProfileState.serializer(), DemoLibrary.state))
            parts.size == 3 && parts[1] == "playback" ->
                DemoLibrary.playback(parts[2])?.let { json(HbJson.encodeToString(com.swissmarley.homeblockbuster.data.PlaybackInfo.serializer(), it)) }
                    ?: MockResponse().setResponseCode(404)
            // The "video" never arrives: the player screenshot shows a still frame instead (see PlayStoreScreenshots).
            path.startsWith("/api/stream/") -> MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
            else -> json("""{"ok":true}""")
        }
    }

    override fun close() {
        runCatching { server.shutdown() }
    }
}
