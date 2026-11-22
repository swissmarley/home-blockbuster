package com.swissmarley.homeblockbuster.player

import android.view.LayoutInflater
import androidx.activity.compose.BackHandler
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FitScreen
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.Subtitles
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.swissmarley.homeblockbuster.MainActivity
import com.swissmarley.homeblockbuster.R
import com.swissmarley.homeblockbuster.data.EpisodeDTO
import com.swissmarley.homeblockbuster.data.PlaybackMode
import com.swissmarley.homeblockbuster.data.ProgressEntry
import com.swissmarley.homeblockbuster.data.TitleKind
import com.swissmarley.homeblockbuster.state.AppModel
import com.swissmarley.homeblockbuster.state.PlayRequest
import com.swissmarley.homeblockbuster.ui.browse.PlayCircle
import com.swissmarley.homeblockbuster.ui.components.PrimaryButton
import com.swissmarley.homeblockbuster.ui.components.ProgressBar
import com.swissmarley.homeblockbuster.ui.components.RemoteImage
import com.swissmarley.homeblockbuster.ui.components.SecondaryButton
import com.swissmarley.homeblockbuster.ui.theme.Hb
import com.swissmarley.homeblockbuster.util.Format
import kotlinx.coroutines.delay

@OptIn(UnstableApi::class)
@Composable
fun PlayerScreen(app: AppModel, activity: MainActivity, request: PlayRequest, onClose: () -> Unit) {
    val context = LocalContext.current
    val controller = remember { PlayerController(context.applicationContext, app, request.fileId) }
    var controlsVisible by remember { mutableStateOf(true) }
    var scrubbing by remember { mutableStateOf(false) }
    var scrubValue by remember { mutableFloatStateOf(0f) }
    var fill by remember { mutableStateOf(false) }
    var episodesOpen by remember { mutableStateOf(false) }
    // Bumped on every interaction so the auto-hide timer restarts.
    var activity_ by remember { mutableIntStateOf(0) }
    val pip = activity.inPictureInPicture
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    fun show() {
        controlsVisible = true
        activity_++
    }

    DisposableEffect(Unit) {
        controller.start(request.fromStart)
        val observer = LifecycleEventObserver { _, event ->
            // Keep playing in picture-in-picture; pause when the app really goes away.
            if (event == Lifecycle.Event.ON_STOP) controller.pause()
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            controller.stop()
        }
    }

    LaunchedEffect(activity_, controller.isPlaying, scrubbing, episodesOpen) {
        if (!controller.isPlaying) {
            controlsVisible = true
            return@LaunchedEffect
        }
        delay(4000)
        if (controller.isPlaying && !scrubbing && !episodesOpen) controlsVisible = false
    }

    BackHandler {
        if (episodesOpen) {
            episodesOpen = false
            show()
        } else {
            onClose()
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            // Swallow touches so nothing underneath reacts.
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {},
    ) {
        AndroidView(
            factory = { ctx ->
                (LayoutInflater.from(ctx).inflate(R.layout.full_player, null) as PlayerView).also {
                    it.player = controller.player
                    it.keepScreenOn = true
                }
            },
            update = { it.resizeMode = if (fill) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT },
            onRelease = { it.player = null },
            modifier = Modifier.fillMaxSize(),
        )

        controller.cueText?.let { text ->
            SubtitleText(
                text, app.preferences.subtitleSize,
                Modifier.align(Alignment.BottomCenter).padding(bottom = if (controlsVisible && !pip) 110.dp else if (pip) 8.dp else 34.dp),
            )
        }

        // Tap target for showing / hiding the controls; double tap fills the screen.
        Box(
            Modifier.fillMaxSize().pointerInput(Unit) {
                detectTapGestures(
                    onTap = { if (controlsVisible) controlsVisible = false else show() },
                    onDoubleTap = { fill = !fill },
                )
            }
        )

        if ((controller.loading || controller.buffering) && controller.error == null) {
            CircularProgressIndicator(Modifier.align(Alignment.Center).size(52.dp), color = Color.White)
        }

        AnimatedVisibility(
            visible = controlsVisible && controller.error == null && !episodesOpen && !pip,
            enter = fadeIn(), exit = fadeOut(),
        ) {
            Controls(
                controller, fill,
                onFill = { fill = !fill },
                onClose = onClose,
                onInteract = { show() },
                scrubbing = scrubbing,
                scrubValue = scrubValue,
                onScrub = { v ->
                    if (!scrubbing) scrubbing = true
                    scrubValue = v
                },
                onScrubEnd = {
                    controller.seek(scrubValue.toDouble())
                    scrubbing = false
                    show()
                },
                onEpisodes = {
                    controller.loadEpisodes()
                    episodesOpen = true
                },
            )
        }

        controller.error?.let { ErrorPanel(it, onClose, onRetry = { controller.retry() }, Modifier.align(Alignment.Center)) }

        val countdown = controller.countdown
        val next = controller.next
        if (countdown != null && next != null && !episodesOpen && !pip) {
            NextCountdown(countdown, next, controller, Modifier.align(Alignment.BottomEnd))
        }

        AnimatedVisibility(
            visible = episodesOpen && !pip,
            enter = slideInVertically { it / 2 } + fadeIn(),
            exit = slideOutVertically { it / 2 } + fadeOut(),
        ) {
            EpisodesPanel(
                controller,
                onPick = { fileId ->
                    episodesOpen = false
                    show()
                    controller.switchTo(fileId)
                },
                onClose = {
                    episodesOpen = false
                    show()
                },
            )
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun Controls(
    controller: PlayerController,
    fill: Boolean,
    onFill: () -> Unit,
    onClose: () -> Unit,
    onInteract: () -> Unit,
    scrubbing: Boolean,
    scrubValue: Float,
    onScrub: (Float) -> Unit,
    onScrubEnd: () -> Unit,
    onEpisodes: () -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(0f to Color.Black.copy(alpha = 0.75f), 0.3f to Color.Transparent, 0.7f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.8f))
            )
        )
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 20.dp, vertical = 8.dp)) {
            // Top bar
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                RoundIcon(Icons.Filled.Close, "Close player", onClose)
                Column(Modifier.weight(1f)) {
                    Text(controller.title?.name ?: "", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val ep = controller.episode
                    val t = controller.title
                    if (ep != null && t != null && (t.kind == TitleKind.SHOW || t.episodeCount > 1)) {
                        Text("${ep.code} “${ep.name}”", fontSize = 14.sp, color = Hb.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                OptionsMenu(controller, fill, onFill, onInteract)
            }
            Spacer(Modifier.weight(1f))
            // Bottom bar
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val shown = if (scrubbing) scrubValue.toDouble() else controller.position
                Text(Format.clock(shown), fontSize = 12.sp)
                Slider(
                    value = shown.toFloat().coerceIn(0f, maxOf(1f, controller.duration.toFloat())),
                    onValueChange = onScrub,
                    onValueChangeFinished = onScrubEnd,
                    valueRange = 0f..maxOf(1f, controller.duration.toFloat()),
                    enabled = controller.duration > 0,
                    colors = SliderDefaults.colors(thumbColor = Hb.red, activeTrackColor = Hb.red, inactiveTrackColor = Color.White.copy(alpha = 0.3f)),
                    modifier = Modifier.weight(1f),
                )
                Text("-" + Format.clock(maxOf(0.0, controller.duration - shown)), fontSize = 12.sp)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (controller.isStreamed) {
                    Icon(Icons.Filled.FlashOn, null, tint = Hb.secondaryText, modifier = Modifier.size(14.dp))
                    Text(
                        if (controller.info?.mode == PlaybackMode.TRANSCODE) "Converted by server" else "Optimized by server",
                        fontSize = 11.sp, color = Hb.secondaryText,
                    )
                }
                Spacer(Modifier.weight(1f))
                if (controller.hasEpisodes) PillButton(Icons.Filled.VideoLibrary, "Episodes", highlighted = false, onClick = onEpisodes)
                if (controller.next != null) {
                    PillButton(Icons.Filled.SkipNext, "Next Episode", highlighted = controller.showsNextButton) { controller.playNext() }
                }
            }
        }
        Row(
            Modifier.align(Alignment.Center),
            horizontalArrangement = Arrangement.spacedBy(60.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!controller.loading) {
                BigIcon(Icons.Filled.Replay10, "Back 10 seconds", 44) { controller.skip(-10.0); onInteract() }
                BigIcon(if (controller.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (controller.isPlaying) "Pause" else "Play", 64) {
                    controller.togglePlay(); onInteract()
                }
                BigIcon(Icons.Filled.Forward10, "Forward 10 seconds", 44) { controller.skip(10.0); onInteract() }
            }
        }
    }
}

@Composable
private fun OptionsMenu(controller: PlayerController, fill: Boolean, onFill: () -> Unit, onInteract: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        RoundIcon(Icons.Filled.Subtitles, "Audio, subtitles and speed") {
            open = true
            onInteract()
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.widthIn(min = 220.dp)) {
            val info = controller.info
            if (info != null) {
                MenuHeader("Subtitles")
                CheckItem("Off", controller.subtitle == null) { controller.selectSubtitle(null); open = false }
                for (track in info.subtitles) {
                    CheckItem(track.label, controller.subtitle?.id == track.id) { controller.selectSubtitle(track); open = false }
                }
                if (info.audioTracks.size > 1) {
                    HorizontalDivider()
                    MenuHeader("Audio")
                    for (track in info.audioTracks) {
                        CheckItem(track.label, controller.audioIndex == track.index) { controller.selectAudio(track.index); open = false }
                    }
                }
                HorizontalDivider()
            }
            MenuHeader("Speed")
            for (r in listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f)) {
                val label = if (r == 1f) "1× (Normal)" else "${r.toString().removeSuffix(".0")}×"
                CheckItem(label, controller.rate == r) { controller.changeRate(r); open = false }
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text(if (fill) "Fit to Screen" else "Fill Screen") },
                leadingIcon = { Icon(if (fill) Icons.Filled.FitScreen else Icons.Filled.Fullscreen, null) },
                onClick = { onFill(); open = false },
            )
        }
    }
}

@Composable
private fun MenuHeader(text: String) {
    Text(text.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Hb.tertiaryText, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
}

@Composable
private fun CheckItem(text: String, checked: Boolean, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(text) },
        leadingIcon = { if (checked) Icon(Icons.Filled.Check, null) else Spacer(Modifier.size(24.dp)) },
        onClick = onClick,
    )
}

@Composable
private fun RoundIcon(icon: ImageVector, label: String, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = Color.White, modifier = Modifier.size(26.dp))
    }
}

@Composable
private fun BigIcon(icon: ImageVector, label: String, size: Int, onClick: () -> Unit) {
    Box(Modifier.size((size + 24).dp).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(icon, label, tint = Color.White, modifier = Modifier.size(size.dp))
    }
}

@Composable
private fun PillButton(icon: ImageVector, text: String, highlighted: Boolean, onClick: () -> Unit) {
    val fg = if (highlighted) Color.Black else Color.White
    Row(
        Modifier
            .clip(RoundedCornerShape(4.dp))
            .background(if (highlighted) Color.White else Color.White.copy(alpha = 0.15f))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(icon, null, tint = fg, modifier = Modifier.size(18.dp))
        Text(text, color = fg, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
    }
}

private val markup = Regex("<[^>]+>")
private val assTags = Regex("\\{[^}]*\\}")

@Composable
private fun SubtitleText(text: String, scale: Double, modifier: Modifier) {
    // Cues may carry simple markup (<i>, <b>, {\an8}).
    val clean = assTags.replace(markup.replace(text, ""), "")
    Text(
        clean,
        textAlign = TextAlign.Center,
        color = Color.White,
        fontSize = (20 * scale).sp,
        fontWeight = FontWeight.SemiBold,
        style = TextStyle(shadow = Shadow(Color.Black, blurRadius = 6f)),
        modifier = modifier
            .padding(horizontal = 40.dp)
            .background(Color.Black.copy(alpha = 0.35f), RoundedCornerShape(4.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

@Composable
private fun ErrorPanel(error: String, onClose: () -> Unit, onRetry: () -> Unit, modifier: Modifier) {
    Column(
        modifier.widthIn(max = 480.dp).padding(24.dp).background(Color.Black.copy(alpha = 0.8f), RoundedCornerShape(16.dp)).padding(30.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(Icons.Filled.Warning, null, tint = Hb.red, modifier = Modifier.size(40.dp))
        Text("Playback problem", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Text(error, fontSize = 14.sp, color = Hb.secondaryText, textAlign = TextAlign.Center)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            SecondaryButton("Close", Modifier.width(130.dp), onClick = onClose)
            PrimaryButton("Try Again", Modifier.width(130.dp), onClick = onRetry)
        }
    }
}

@Composable
private fun NextCountdown(seconds: Int, next: EpisodeDTO, controller: PlayerController, modifier: Modifier) {
    Column(
        modifier.safeDrawingPadding().padding(24.dp).background(Color.Black.copy(alpha = 0.75f), RoundedCornerShape(12.dp)).padding(20.dp),
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Next: ${next.code} “${next.name}”", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryButton("Cancel", Modifier.width(110.dp)) { controller.cancelCountdown() }
            PrimaryButton("Play in $seconds", Modifier.width(150.dp), Icons.Filled.PlayArrow) { controller.playNext() }
        }
    }
}

/** Netflix-style episode picker shown over the playing video. */
@Composable
private fun EpisodesPanel(controller: PlayerController, onPick: (String) -> Unit, onClose: () -> Unit) {
    var season by remember { mutableStateOf(controller.episode?.season) }
    var menu by remember { mutableStateOf(false) }
    val seasons = controller.detail?.seasons ?: emptyList()
    val current = seasons.firstOrNull { it.number == season }
        ?: seasons.firstOrNull { it.number == controller.episode?.season }
        ?: seasons.firstOrNull()
    val listState = rememberLazyListState()

    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Black.copy(alpha = 0.92f))))
            .pointerInput(Unit) { detectTapGestures { onClose() } },
    ) {
        Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().safeDrawingPadding().padding(vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(Modifier.padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                if (seasons.size > 1) {
                    Box {
                        Row(
                            Modifier.clip(RoundedCornerShape(6.dp)).background(Color.White.copy(alpha = 0.15f)).clickable { menu = true }
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(current?.name ?: "Season", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            Icon(Icons.Filled.KeyboardArrowDown, null, tint = Color.White)
                        }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            for (s in seasons) CheckItem(s.name, s.number == current?.number) { season = s.number; menu = false }
                        }
                    }
                } else {
                    Text(current?.name ?: controller.title?.name ?: "Episodes", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.weight(1f))
                RoundIcon(Icons.Filled.Close, "Close episodes", onClose)
            }
            if (controller.detail == null) {
                Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Color.White) }
            } else {
                val episodes = current?.episodes ?: emptyList()
                LazyRow(state = listState, contentPadding = PaddingValues(horizontal = 24.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(episodes, key = { it.fileId }) { ep ->
                        EpisodeTile(
                            ep,
                            playing = ep.fileId == controller.info?.fileId,
                            progress = controller.progressFor(ep.fileId),
                            fallbackArt = controller.detail?.images?.wide,
                        ) { onPick(ep.fileId) }
                    }
                }
                LaunchedEffect(current?.number, controller.detail?.id) {
                    val idx = episodes.indexOfFirst { it.fileId == controller.info?.fileId }
                    if (idx >= 0) listState.scrollToItem(maxOf(0, idx - 1))
                }
            }
        }
    }
}

@Composable
private fun EpisodeTile(episode: EpisodeDTO, playing: Boolean, progress: ProgressEntry?, fallbackArt: String?, onClick: () -> Unit) {
    Column(
        Modifier.width(240.dp).clip(RoundedCornerShape(4.dp)).clickable(enabled = !playing, onClick = onClick),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier.width(240.dp).height(135.dp).clip(RoundedCornerShape(4.dp))
                .then(if (playing) Modifier.border(2.dp, Color.White, RoundedCornerShape(4.dp)) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            RemoteImage(episode.still ?: fallbackArt, Modifier.fillMaxSize())
            if (playing) {
                Text(
                    "NOW PLAYING", fontSize = 10.sp, fontWeight = FontWeight.ExtraBold,
                    modifier = Modifier.align(Alignment.TopStart).padding(8.dp).background(Hb.red, RoundedCornerShape(2.dp)).padding(horizontal = 6.dp, vertical = 3.dp),
                )
            } else {
                PlayCircle(40.dp)
            }
            if (progress != null && progress.duration > 0) {
                ProgressBar(
                    if (progress.finished) 1f else (progress.position / progress.duration).toFloat(),
                    Modifier.fillMaxWidth().align(Alignment.BottomCenter),
                    track = Color.White.copy(alpha = 0.3f),
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${episode.episode}. ${episode.name}", Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Format.runtime(episode.runtime ?: episode.duration?.div(60))?.let { Text(it, fontSize = 12.sp, color = Hb.secondaryText) }
        }
        if (episode.overview.isNotEmpty()) {
            Text(episode.overview, fontSize = 12.sp, color = Hb.secondaryText, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}
