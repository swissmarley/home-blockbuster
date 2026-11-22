package com.swissmarley.homeblockbuster.player

import android.content.Context
import androidx.annotation.OptIn
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.swissmarley.homeblockbuster.data.ApiClient
import com.swissmarley.homeblockbuster.data.ApiException
import com.swissmarley.homeblockbuster.data.AppPreferences
import com.swissmarley.homeblockbuster.data.EpisodeDTO
import com.swissmarley.homeblockbuster.data.PlaybackInfo
import com.swissmarley.homeblockbuster.data.PlaybackMode
import com.swissmarley.homeblockbuster.data.ProfileDTO
import com.swissmarley.homeblockbuster.data.ProgressEntry
import com.swissmarley.homeblockbuster.data.SubtitleCue
import com.swissmarley.homeblockbuster.data.SubtitleTrack
import com.swissmarley.homeblockbuster.data.TitleDetail
import com.swissmarley.homeblockbuster.data.TitleKind
import com.swissmarley.homeblockbuster.data.TitleSummary
import com.swissmarley.homeblockbuster.state.AppModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * Drives one playback session: picks direct play or the server's HLS conversion, keeps the absolute
 * position (HLS streams start at `streamStart`), loads subtitles and syncs progress to the profile.
 */
@OptIn(UnstableApi::class)
class PlayerController(private val context: Context, private val app: AppModel, private var fileId: String) {
    val player: ExoPlayer = ExoPlayer.Builder(context)
        .setSeekBackIncrementMs(10_000)
        .setSeekForwardIncrementMs(10_000)
        .build()
        .apply {
            setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
            setHandleAudioBecomingNoisy(true)
        }

    var info by mutableStateOf<PlaybackInfo?>(null)
        private set
    var loading by mutableStateOf(true)
        private set
    var buffering by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    var isPlaying by mutableStateOf(false)
        private set
    /** Seconds from the start of the file. */
    var position by mutableDoubleStateOf(0.0)
        private set
    var duration by mutableDoubleStateOf(0.0)
        private set
    var rate by mutableFloatStateOf(1f)
        private set

    var subtitle by mutableStateOf<SubtitleTrack?>(null)
        private set
    var cueText by mutableStateOf<String?>(null)
        private set
    var audioIndex by mutableStateOf<Int?>(null)
        private set

    var ended by mutableStateOf(false)
        private set
    var countdown by mutableStateOf<Int?>(null)
        private set

    private val client: ApiClient? = app.client
    private val profile: ProfileDTO? = app.profile
    private val preferences: AppPreferences = app.preferences

    private var streamStart = 0.0
    private var cues: List<SubtitleCue> = emptyList()
    private var cueIndex = 0
    private var lastReport = 0L
    private var lastReportedPosition = -1.0
    private var triedConversion = false
    private var pendingSeek: Double? = null
    private var countdownJob: Job? = null
    private var tickJob: Job? = null
    private var loadJob: Job? = null
    private var loadGeneration = 0

    val title: TitleSummary? get() = info?.title
    val episode: EpisodeDTO? get() = info?.episode
    val next: EpisodeDTO? get() = info?.next
    val isStreamed: Boolean get() = info?.let { it.mode != PlaybackMode.DIRECT } ?: false
    val showsNextButton: Boolean get() = next != null && duration > 0 && (ended || duration - position < 40)

    // region Lifecycle

    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(playing: Boolean) {
            isPlaying = playing || (player.playWhenReady && player.playbackState == Player.STATE_BUFFERING)
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            isPlaying = player.isPlaying || (playWhenReady && player.playbackState == Player.STATE_BUFFERING)
        }

        override fun onPlaybackStateChanged(state: Int) {
            buffering = state == Player.STATE_BUFFERING && !loading
            when (state) {
                Player.STATE_READY -> {
                    if (loading) {
                        loading = false
                        pendingSeek?.let {
                            pendingSeek = null
                            player.seekTo((it * 1000).toLong())
                        }
                    }
                    if (duration <= 0 && player.duration != C.TIME_UNSET) duration = player.duration / 1000.0 + streamStart
                }
                Player.STATE_ENDED -> didEnd()
                else -> Unit
            }
        }

        override fun onPlayerError(e: PlaybackException) {
            // The file looked playable but this phone refused it: let the server convert it instead.
            if (info?.mode == PlaybackMode.DIRECT && info?.canTranscode == true && !triedConversion) {
                triedConversion = true
                startLoad(position, force = true)
                return
            }
            loading = false
            error = e.message?.takeIf { it.isNotBlank() } ?: "This video can't be played."
        }
    }

    fun start(fromStart: Boolean) {
        app.previews.suspended = true
        player.addListener(listener)
        tickJob = app.scope.launch {
            while (isActive) {
                tick()
                delay(250)
            }
        }
        startLoad(if (fromStart) 0.0 else null)
    }

    fun stop() {
        countdownJob?.cancel()
        tickJob?.cancel()
        loadJob?.cancel()
        reportProgress(force = true)
        player.removeListener(listener)
        player.release()
    }

    fun pause() {
        player.pause()
        reportProgress(force = true)
    }

    private fun startLoad(position: Double?, audio: Int? = null, force: Boolean = false) {
        loadJob?.cancel()
        loadJob = app.scope.launch { load(position, audio, force) }
    }

    /** (Re)load the current file. `requested` null = resume point from the server. */
    private suspend fun load(requested: Double?, audio: Int? = null, force: Boolean = false) {
        val c = client ?: return
        loadGeneration += 1
        val generation = loadGeneration
        loading = true
        error = null
        ended = false
        countdown = null
        countdownJob?.cancel()
        try {
            val newInfo = c.playback(fileId, profile?.id, audio ?: audioIndex, force || preferences.alwaysConvert)
            if (generation != loadGeneration) return
            val firstLoad = info?.fileId != newInfo.fileId
            info = newInfo
            if (audioIndex == null || firstLoad) audioIndex = audio ?: newInfo.audioTracks.firstOrNull { it.default }?.index
            duration = newInfo.duration ?: 0.0
            val target = requested ?: newInfo.resumeAt
            open(c, newInfo, target, generation)
            if (firstLoad) autoSelectSubtitles(newInfo)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (generation != loadGeneration) return
            loading = false
            error = e.message ?: "This video can't be played."
        }
    }

    private suspend fun open(c: ApiClient, info: PlaybackInfo, target: Double, generation: Int) {
        val url: String
        if (info.mode == PlaybackMode.DIRECT) {
            url = c.url(info.url)
            streamStart = 0.0
            pendingSeek = null
        } else {
            val template = info.hlsUrl ?: throw ApiException(
                0,
                "This video needs to be converted for this phone, and this server is too old to do that. " +
                    "Update Home Blockbuster on the server (docker compose pull && docker compose up -d).",
            )
            var start = max(0.0, target)
            if (info.mode == PlaybackMode.REMUX && start > 0) {
                // A copied video stream can only start on a keyframe; ask where that is so the clock stays right.
                start = runCatching { c.keyframe(info.fileId, start) }.getOrDefault(start)
            }
            if (generation != loadGeneration) return
            url = c.url(
                template.replace("{session}", Media.newSession(16)) +
                    "&start=${String.format(Locale.US, "%.3f", start)}&maxh=${preferences.quality.maxHeight}"
            )
            streamStart = start
            pendingSeek = null
        }
        position = target
        val q = preferences.quality
        player.trackSelectionParameters = if (info.mode != PlaybackMode.DIRECT && q != AppPreferences.Quality.ORIGINAL) {
            player.trackSelectionParameters.buildUpon().setMaxVideoSize(q.maxHeight * 16 / 9, q.maxHeight).build()
        } else {
            player.trackSelectionParameters.buildUpon().clearVideoSizeConstraints().build()
        }
        val startMs = if (info.mode == PlaybackMode.DIRECT && target > 1) (target * 1000).toLong() else 0L
        player.setMediaSource(Media.source(context, c, url, hls = info.mode != PlaybackMode.DIRECT), startMs)
        player.playbackParameters = PlaybackParameters(rate)
        player.prepare()
        player.playWhenReady = true
    }

    // endregion

    // region Clock

    private fun tick() {
        if (loading || player.playbackState == Player.STATE_IDLE) return
        position = streamStart + player.currentPosition / 1000.0
        updateCue()
        if (player.isPlaying) reportProgress()
    }

    private fun didEnd() {
        if (ended) return
        ended = true
        reportProgress(force = true)
        if (next != null && (profile?.autoplayNext ?: true)) startCountdown()
    }

    private fun startCountdown() {
        countdownJob?.cancel()
        countdown = 8
        countdownJob = app.scope.launch {
            while ((countdown ?: 0) > 0) {
                delay(1000)
                countdown = (countdown ?: 1) - 1
            }
            playNext()
        }
    }

    fun cancelCountdown() {
        countdownJob?.cancel()
        countdown = null
    }

    // endregion

    // region Controls

    fun togglePlay() {
        if (player.playWhenReady && !ended) {
            player.pause()
            reportProgress(force = true)
        } else {
            if (ended) seek(0.0)
            player.play()
        }
    }

    fun skip(delta: Double) = seek(position + delta)

    fun changeRate(r: Float) {
        rate = r
        player.playbackParameters = PlaybackParameters(r)
    }

    fun seek(absolute: Double) {
        val target = max(0.0, if (duration > 0) min(absolute, duration - 1) else absolute)
        ended = false
        cancelCountdown()
        position = target
        cueIndex = 0
        if (!isStreamed) {
            player.seekTo((target * 1000).toLong())
            return
        }
        // Inside what the server has converted so far: seek natively. Further: restart the conversion there.
        val relative = target - streamStart
        val available = if (player.duration != C.TIME_UNSET) player.duration / 1000.0 else 0.0
        if (relative >= 0 && relative <= available - 2) {
            player.seekTo((relative * 1000).toLong())
        } else {
            startLoad(target)
        }
    }

    fun selectAudio(index: Int) {
        if (index == audioIndex) return
        audioIndex = index
        startLoad(position, audio = index)
    }

    fun selectSubtitle(track: SubtitleTrack?) {
        subtitle = track
        cues = emptyList()
        cueIndex = 0
        cueText = null
        val c = client ?: return
        val i = info ?: return
        if (track == null) return
        app.scope.launch {
            try {
                val loaded = c.subtitles(i.fileId, track.id)
                if (subtitle?.id != track.id) return@launch
                cues = loaded.sortedBy { it.start }
                updateCue()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                app.showToast("Couldn't load subtitles: ${e.message}")
            }
        }
    }

    private fun autoSelectSubtitles(info: PlaybackInfo) {
        if (subtitle != null) return
        val lang = profile?.subtitleLang?.lowercase()
        val match = lang?.let { l ->
            info.subtitles.firstOrNull { (it.language ?: "").lowercase().startsWith(l) && !it.forced }
                ?: info.subtitles.firstOrNull { (it.language ?: "").lowercase().startsWith(l) }
        }
        if (match != null) selectSubtitle(match)
        else info.subtitles.firstOrNull { it.forced }?.let { selectSubtitle(it) }
    }

    private fun updateCue() {
        if (cues.isEmpty()) {
            if (cueText != null) cueText = null
            return
        }
        val t = position
        if (cueIndex >= cues.size || cues[cueIndex].start > t) cueIndex = 0
        while (cueIndex < cues.size - 1 && cues[cueIndex].end < t) cueIndex++
        val cue = cues[cueIndex]
        val text = if (cue.start <= t && t <= cue.end) cue.text else null
        if (text != cueText) cueText = text
    }

    fun playNext() {
        val n = next ?: return
        switchTo(n.fileId, fromStart = true)
    }

    /** Jump to another episode of the same title. Picked from the list it resumes where you left off. */
    fun switchTo(newFile: String, fromStart: Boolean = false) {
        if (newFile == info?.fileId && error == null) return
        reportProgress(force = true)
        info?.let { i ->
            if (duration > 0) {
                // Keep the episode list's progress bars current without a round trip.
                progressOverrides[i.fileId] = ProgressEntry(
                    i.fileId, i.titleId, if (ended) duration else position, duration,
                    System.currentTimeMillis().toDouble(), ended || duration - position < 60,
                )
            }
        }
        player.pause()
        fileId = newFile
        subtitle = null
        cues = emptyList()
        cueText = null
        audioIndex = null
        triedConversion = false
        lastReportedPosition = -1.0
        position = 0.0
        duration = 0.0
        startLoad(if (fromStart) 0.0 else null)
    }

    fun retry() = startLoad(position)

    // endregion

    // region Episodes

    /** Seasons and episodes of the playing title, for the in-player episode list. */
    var detail by mutableStateOf<TitleDetail?>(null)
        private set
    private var detailLoading = false
    private val progressOverrides = mutableMapOf<String, ProgressEntry>()

    val hasEpisodes: Boolean
        get() {
            val t = title ?: return false
            return info?.episode != null && (t.kind == TitleKind.SHOW || t.episodeCount > 1)
        }

    fun loadEpisodes() {
        val c = client ?: return
        val titleId = info?.titleId ?: return
        if (detail?.id == titleId || detailLoading) return
        detailLoading = true
        app.scope.launch {
            detail = runCatching { c.title(titleId, profile?.id) }.getOrNull()
            detailLoading = false
        }
    }

    /** Saved progress for an episode, including what was watched in this session. */
    fun progressFor(fileId: String): ProgressEntry? {
        if (fileId == info?.fileId && duration > 0) {
            return ProgressEntry(fileId, info?.titleId ?: "", position, duration, 0.0, false)
        }
        return progressOverrides[fileId] ?: app.progress(fileId)
    }

    // endregion

    // region Progress

    private fun reportProgress(force: Boolean = false) {
        val c = client ?: return
        val p = profile ?: return
        val i = info ?: return
        if (duration <= 0) return
        val pos = if (ended) duration else position
        if (pos <= 0 || abs(pos - lastReportedPosition) < 1) return
        val now = System.currentTimeMillis()
        if (!force && now - lastReport < 10_000) return
        lastReport = now
        lastReportedPosition = pos
        val total = duration
        app.scope.launch {
            withContext(NonCancellable) { runCatching { c.progress(p.id, i.fileId, pos, total) } }
        }
    }

    // endregion
}
