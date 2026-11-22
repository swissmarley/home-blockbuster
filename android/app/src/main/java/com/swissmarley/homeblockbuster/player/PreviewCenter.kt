package com.swissmarley.homeblockbuster.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.swissmarley.homeblockbuster.data.PlaybackInfo
import com.swissmarley.homeblockbuster.data.PlaybackMode
import com.swissmarley.homeblockbuster.data.TitleSummary
import com.swissmarley.homeblockbuster.state.AppModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToLong

/**
 * Netflix-style muted previews. One shared player: only one surface (title page, long-press peek)
 * plays at a time. The highest-priority surface that asked wins; when it goes away the next one resumes.
 */
@OptIn(UnstableApi::class)
class PreviewCenter(private val context: Context, private val app: AppModel) {
    enum class Priority { PAGE, PEEK }
    enum class Phase { WAITING, LOADING, PLAYING, FINISHED, FAILED }

    private val prefs = context.getSharedPreferences("app", Context.MODE_PRIVATE)

    val player: ExoPlayer by lazy {
        ExoPlayer.Builder(context).build().apply {
            // Muted previews don't take audio focus, so they never interrupt the user's music.
            setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), false)
            trackSelectionParameters = trackSelectionParameters.buildUpon().setMaxVideoSize(1280, 720).build()
            volume = if (muted) 0f else 1f
            addListener(listener)
        }
    }

    var muted by mutableStateOf(prefs.getBoolean(MUTED_KEY, true))
        private set

    fun toggleMuted() {
        muted = !muted
        prefs.edit().putBoolean(MUTED_KEY, muted).apply()
        player.volume = if (muted) 0f else 1f
    }

    /** Paused while the full player is up or the app is in the background. */
    var suspended: Boolean = false
        set(value) {
            if (field != value) {
                field = value
                reconcile()
            }
        }

    private val phases = mutableStateMapOf<String, Phase>()
    var current by mutableStateOf<String?>(null)
        private set

    private data class Request(
        val id: String,
        val title: TitleSummary,
        val priority: Priority,
        val delayMs: Long,
        val maxSeconds: Double,
        val order: Int,
    )

    private val requests = mutableMapOf<String, Request>()
    private var order = 0
    private var startJob: Job? = null
    private var stopJob: Job? = null
    /** Playback decisions per file, so replays and re-visits start instantly. */
    private val infoCache = mutableMapOf<String, PlaybackInfo>()

    fun phase(id: String): Phase = phases[id] ?: Phase.WAITING
    fun isPlaying(id: String): Boolean = current == id && phases[id] == Phase.PLAYING

    /** Whether this title can show a preview at all for the signed-in profile. */
    fun canPreview(title: TitleSummary?): Boolean {
        if (title == null || title.previewUrl == null || title.playFileId == null || !title.isAvailable) return false
        return app.profile?.autoplayPreviews ?: true
    }

    fun request(id: String, title: TitleSummary, priority: Priority, delayMs: Long = 1200, maxSeconds: Double = 90.0) {
        if (!canPreview(title)) return
        val existing = requests[id]
        if (existing == null || existing.title.id != title.id) {
            order += 1
            requests[id] = Request(id, title, priority, delayMs, maxSeconds, order)
            phases[id] = Phase.WAITING
        }
        reconcile()
    }

    fun release(id: String) {
        requests.remove(id)
        phases.remove(id)
        reconcile()
    }

    fun replay(id: String) {
        if (requests[id] == null) return
        phases[id] = Phase.WAITING
        if (current == id) stopPlayer()
        reconcile()
    }

    // region Scheduling

    private fun winner(): Request? = requests.values
        .filter { phases[it.id] != Phase.FINISHED && phases[it.id] != Phase.FAILED }
        .maxWithOrNull(compareBy<Request> { it.priority.ordinal }.thenBy { it.order })

    private fun reconcile() {
        val next = if (suspended) null else winner()
        if (next?.id == current && current != null) return
        current?.let { cur ->
            // Lost the slot: it can start again later.
            if (phases[cur] == Phase.PLAYING || phases[cur] == Phase.LOADING) phases[cur] = Phase.WAITING
        }
        stopPlayer()
        if (next == null) return
        current = next.id
        startJob = app.scope.launch {
            delay(next.delayMs)
            if (current == next.id) start(next)
        }
    }

    private fun stopPlayer() {
        startJob?.cancel()
        stopJob?.cancel()
        if (current != null) {
            player.stop()
            player.clearMediaItems()
        }
        current = null
    }

    private fun finish(id: String, failed: Boolean = false) {
        if (current != id) return
        phases[id] = if (failed) Phase.FAILED else Phase.FINISHED
        stopPlayer()
        reconcile()
    }

    // endregion

    // region Playback

    private suspend fun start(req: Request) {
        val client = app.client
        val fileId = req.title.playFileId
        if (client == null || fileId == null) return finish(req.id, failed = true)
        phases[req.id] = Phase.LOADING
        val info = infoCache[fileId] ?: try {
            client.playback(fileId, app.profile?.id).also { infoCache[fileId] = it }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            return finish(req.id, failed = true)
        }
        if (current != req.id) return

        val duration = info.duration ?: 0.0
        // Skip opening credits on anything long enough to have them (same rule as the web app).
        val offset = if (duration >= 600) (duration * 0.12).roundToLong().toDouble() else 0.0
        val (url, seekTo, hls) = when (info.mode) {
            PlaybackMode.DIRECT -> Triple(client.url(info.url), offset, false)
            // Cheap stream copy into HLS. Never ask the server to fully transcode just for a preview.
            PlaybackMode.REMUX -> info.hlsUrl?.let {
                Triple(client.url(it.replace("{session}", "preview" + Media.newSession(12)) + "&start=${offset.toLong()}&maxh=720"), 0.0, true)
            } ?: return finish(req.id, failed = true)
            PlaybackMode.TRANSCODE -> return finish(req.id, failed = true)
        }
        player.volume = if (muted) 0f else 1f
        player.setMediaSource(Media.source(context, client, url, hls), (seekTo * 1000).toLong())
        player.prepare()
        player.playWhenReady = true
    }

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val id = current ?: return
            if (isPlaying && phases[id] == Phase.LOADING) {
                phases[id] = Phase.PLAYING
                val max = requests[id]?.maxSeconds ?: 90.0
                stopJob?.cancel()
                stopJob = app.scope.launch {
                    delay((max * 1000).toLong())
                    finish(id)
                }
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            val id = current ?: return
            if (playbackState == Player.STATE_ENDED && phases[id] == Phase.PLAYING) finish(id)
        }

        override fun onPlayerError(error: PlaybackException) {
            current?.let { finish(it, failed = true) }
        }
    }

    // endregion

    private companion object {
        const val MUTED_KEY = "previews.muted"
    }
}
