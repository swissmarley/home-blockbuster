package com.swissmarley.homeblockbuster.ui.browse

import android.view.LayoutInflater
import androidx.annotation.OptIn
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.PlayerView
import com.swissmarley.homeblockbuster.R
import com.swissmarley.homeblockbuster.data.ContinueItem
import com.swissmarley.homeblockbuster.data.TitleSummary
import com.swissmarley.homeblockbuster.player.PreviewCenter
import com.swissmarley.homeblockbuster.state.AppModel
import com.swissmarley.homeblockbuster.ui.components.Badge
import com.swissmarley.homeblockbuster.ui.components.PrimaryButton
import com.swissmarley.homeblockbuster.ui.components.ProgressBar
import com.swissmarley.homeblockbuster.ui.components.RemoteImage
import com.swissmarley.homeblockbuster.ui.components.SecondaryButton
import com.swissmarley.homeblockbuster.ui.theme.Hb
import com.swissmarley.homeblockbuster.util.Format

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PosterCard(title: TitleSummary, width: Dp = 112.dp, onClick: () -> Unit, onLongClick: (() -> Unit)? = null) {
    Box(
        Modifier
            .width(width)
            .aspectRatio(2f / 3f)
            .clip(RoundedCornerShape(4.dp))
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
    ) {
        val art = title.images.poster ?: title.images.thumb ?: title.images.wide
        if (art == null) {
            Box(Modifier.fillMaxSize().background(Hb.surface).padding(8.dp), contentAlignment = Alignment.Center) {
                Text(title.name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            }
        } else {
            RemoteImage(art, Modifier.fillMaxSize())
        }
        if (title.images.poster == null && art != null) {
            Text(
                title.name,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.8f))))
                    .padding(6.dp),
            )
        }
        if (!title.isAvailable) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.CloudOff, "Offline", tint = Color.White)
            }
        }
    }
}

@Composable
fun Top10Card(rank: Int, title: TitleSummary, onClick: () -> Unit, onLongClick: () -> Unit) {
    Row(Modifier.height(150.dp).clipToBounds(), verticalAlignment = Alignment.Bottom) {
        Box(Modifier.widthIn(min = 58.dp).offset(y = 18.dp)) {
            // Outlined numeral, like the TV app: a grey stroke under a background-coloured fill.
            val style = TextStyle(fontSize = 120.sp, fontWeight = FontWeight.Black, lineHeight = 120.sp)
            Text("$rank", style = style.copy(color = Color(0xFF9E9E9E), drawStyle = Stroke(width = 6f)))
            Text("$rank", style = style.copy(color = Hb.background))
        }
        Box(Modifier.offset(x = (-14).dp)) {
            PosterCard(title, 100.dp, onClick, onLongClick)
        }
    }
}

@Composable
fun ContinueCard(app: AppModel, item: ContinueItem, onInfo: () -> Unit) {
    val title = app.titleMap[item.titleId]
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.width(190.dp).clip(RoundedCornerShape(4.dp))) {
        Box(
            Modifier.width(190.dp).height(107.dp).clickable { app.play(item.fileId, item.titleId) },
            contentAlignment = Alignment.Center,
        ) {
            RemoteImage(item.episode?.still ?: title?.images?.wide ?: title?.images?.poster, Modifier.fillMaxSize())
            PlayCircle(44.dp)
        }
        ProgressBar(if (item.upNext) 0f else item.progress.toFloat(), Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth().background(Hb.surface).padding(start = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title?.name ?: "", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val sub = item.episode?.let { ep ->
                    if (item.upNext) "Up next · ${ep.code}"
                    else "${ep.code} · ${Format.progressLabel(item.position, item.duration) ?: ""}"
                } ?: Format.progressLabel(item.position, item.duration) ?: ""
                Text(sub, fontSize = 11.sp, color = Hb.secondaryText, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box {
                Icon(
                    Icons.Filled.MoreVert, "More", tint = Hb.secondaryText,
                    modifier = Modifier.size(32.dp).clip(CircleShape).clickable { menu = true }.padding(4.dp),
                )
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Episodes & Info") }, leadingIcon = { Icon(Icons.Filled.Info, null) },
                        onClick = { menu = false; onInfo() },
                    )
                    DropdownMenuItem(
                        text = { Text("Play from Beginning") }, leadingIcon = { Icon(Icons.Filled.SkipPrevious, null) },
                        onClick = { menu = false; app.play(item.fileId, item.titleId, fromStart = true) },
                    )
                    DropdownMenuItem(
                        text = { Text("Remove from Row", color = Hb.red) }, leadingIcon = { Icon(Icons.Filled.Close, null, tint = Hb.red) },
                        onClick = { menu = false; app.hideFromContinue(item.titleId) },
                    )
                }
            }
        }
    }
}

@Composable
fun PlayCircle(size: Dp) {
    Box(
        Modifier.size(size).background(Color.Black.copy(alpha = 0.55f), CircleShape).border(1.5.dp, Color.White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(size * 0.55f))
    }
}

/** The shared preview video, faded in over the artwork once it is actually playing. */
@OptIn(UnstableApi::class)
@Composable
fun PreviewVideo(center: PreviewCenter, id: String, modifier: Modifier = Modifier) {
    val owner = center.current == id
    val playing = center.isPlaying(id)
    val alpha by animateFloatAsState(if (playing) 1f else 0f, tween(600), label = "preview")
    if (!owner) return
    var view by remember { mutableStateOf<PlayerView?>(null) }
    AndroidView(
        factory = { ctx ->
            (LayoutInflater.from(ctx).inflate(R.layout.preview_player, null) as PlayerView).also {
                it.player = center.player
                view = it
            }
        },
        modifier = modifier.alpha(alpha),
    )
    DisposableEffect(Unit) {
        onDispose { view?.player = null }
    }
}

/** Mute toggle while a preview plays, replay once it has finished. */
@Composable
fun PreviewControlButton(center: PreviewCenter, id: String, modifier: Modifier = Modifier) {
    val playing = center.isPlaying(id)
    val finished = center.phase(id) == PreviewCenter.Phase.FINISHED
    if (!playing && !finished) return
    Box(
        modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.35f))
            .border(1.dp, Color.White.copy(alpha = 0.7f), CircleShape)
            .clickable { if (playing) center.toggleMuted() else center.replay(id) },
        contentAlignment = Alignment.Center,
    ) {
        val icon = when {
            !playing -> Icons.Filled.Replay
            center.muted -> Icons.AutoMirrored.Filled.VolumeOff
            else -> Icons.AutoMirrored.Filled.VolumeUp
        }
        val label = when {
            !playing -> "Replay preview"
            center.muted -> "Unmute preview"
            else -> "Mute preview"
        }
        Icon(icon, label, tint = Color.White, modifier = Modifier.size(18.dp))
    }
}

/** Long-press preview for a title card: the phone stand-in for the web app's hover card. */
@Composable
fun TitlePeek(app: AppModel, title: TitleSummary, onDismiss: () -> Unit, onInfo: () -> Unit) {
    val previewId = "peek-${title.id}"
    DisposableEffect(title.id) {
        app.previews.request(previewId, title, PreviewCenter.Priority.PEEK, delayMs = 350, maxSeconds = 60.0)
        onDispose { app.previews.release(previewId) }
    }
    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.widthIn(max = 360.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Hb.surface)) {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clipToBounds()) {
                RemoteImage(title.images.wide ?: title.images.poster, Modifier.fillMaxSize())
                PreviewVideo(app.previews, previewId, Modifier.fillMaxSize())
                PreviewControlButton(app.previews, previewId, Modifier.align(Alignment.BottomEnd).padding(10.dp))
            }
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(title.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 2)
                MetaLine(title.rating, title.year, title.maturity, Format.length(title.kind, title.runtime, title.seasonCount, title.episodeCount), null)
                if (title.genres.isNotEmpty()) Text(title.genres.take(3).joinToString(" • "), fontSize = 12.sp)
                if (title.overview.isNotEmpty()) {
                    Text(title.overview, fontSize = 12.sp, color = Hb.secondaryText, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                    val file = app.playTarget(title)
                    PrimaryButton("Play", Modifier.weight(1f), Icons.Filled.PlayArrow, enabled = file != null && title.isAvailable) {
                        if (file != null) {
                            onDismiss()
                            app.play(file, title.id)
                        }
                    }
                    SecondaryButton("My List", Modifier.weight(1f), if (app.isInList(title.id)) Icons.Filled.Check else Icons.Filled.Add) {
                        app.toggleList(title.id)
                    }
                }
                SecondaryButton("Episodes & Info", Modifier.fillMaxWidth(), Icons.Filled.Info) {
                    onDismiss()
                    onInfo()
                }
            }
        }
    }
}

/** "97% Match · 2021 · PG-13 · 2h 4m · 4K" */
@Composable
fun MetaLine(rating: Double?, year: Int?, maturity: String?, length: String?, quality: String?, fontSize: Int = 12) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Format.matchPercent(rating)?.let { Text("$it% Match", color = Hb.match, fontWeight = FontWeight.SemiBold, fontSize = fontSize.sp) }
        year?.let { Text("$it", color = Hb.secondaryText, fontSize = fontSize.sp) }
        maturity?.let { Badge(it, outlined = false) }
        length?.let { Text(it, color = Hb.secondaryText, fontSize = fontSize.sp) }
        quality?.let { Badge(it) }
    }
}

