package com.swissmarley.homeblockbuster.ui.detail

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.swissmarley.homeblockbuster.data.EpisodeDTO
import com.swissmarley.homeblockbuster.data.TitleDetail
import com.swissmarley.homeblockbuster.data.TitleKind
import com.swissmarley.homeblockbuster.player.PreviewCenter
import com.swissmarley.homeblockbuster.state.AppModel
import com.swissmarley.homeblockbuster.ui.browse.MetaLine
import com.swissmarley.homeblockbuster.ui.browse.OpenTitle
import com.swissmarley.homeblockbuster.ui.browse.PlayCircle
import com.swissmarley.homeblockbuster.ui.browse.PosterCard
import com.swissmarley.homeblockbuster.ui.browse.PreviewControlButton
import com.swissmarley.homeblockbuster.ui.browse.PreviewVideo
import com.swissmarley.homeblockbuster.ui.components.EmptyState
import com.swissmarley.homeblockbuster.ui.components.IconAction
import com.swissmarley.homeblockbuster.ui.components.Loading
import com.swissmarley.homeblockbuster.ui.components.PrimaryButton
import com.swissmarley.homeblockbuster.ui.components.ProgressBar
import com.swissmarley.homeblockbuster.ui.components.RemoteImage
import com.swissmarley.homeblockbuster.ui.components.SecondaryButton
import com.swissmarley.homeblockbuster.ui.theme.Hb
import com.swissmarley.homeblockbuster.util.Format
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private enum class DetailTab { EPISODES, SIMILAR }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TitleDetailScreen(app: AppModel, titleId: String, open: OpenTitle, onBack: () -> Unit) {
    var detail by remember { mutableStateOf<TitleDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var season by rememberSaveable { mutableStateOf<Int?>(null) }
    var tab by rememberSaveable { mutableStateOf(DetailTab.EPISODES) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val summary = app.titleMap[titleId]

    suspend fun load() {
        val client = app.client ?: return
        try {
            val d = client.title(titleId, app.profile?.id)
            detail = d
            error = null
            if (season == null || d.seasons.none { it.number == season }) {
                season = resumeEpisode(app, d)?.season ?: d.seasons.firstOrNull { it.number > 0 }?.number ?: d.seasons.firstOrNull()?.number
            }
            if (d.seasons.isEmpty()) tab = DetailTab.SIMILAR
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (detail == null) error = e.message
        }
    }

    LaunchedEffect(titleId, app.libraryVersion) { load() }

    val previewId = "page-$titleId"
    DisposableEffect(previewId, summary?.id) {
        summary?.let { app.previews.request(previewId, it, PreviewCenter.Priority.PAGE, delayMs = 1200) }
        onDispose { app.previews.release(previewId) }
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch { load(); refreshing = false }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            val images = detail?.images ?: summary?.images
            Box(Modifier.fillMaxWidth().height(300.dp).clipToBounds()) {
                RemoteImage(images?.backdrop ?: images?.card ?: images?.thumb ?: images?.poster, Modifier.fillMaxSize())
                PreviewVideo(app.previews, previewId, Modifier.fillMaxSize())
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.4f), Color.Transparent, Hb.background))))
                images?.logo?.let { logo ->
                    RemoteImage(
                        logo,
                        Modifier.align(Alignment.BottomStart).padding(16.dp).widthIn(max = 220.dp).fillMaxWidth().heightIn(max = 80.dp).height(80.dp),
                        ContentScale.Fit, Color.Transparent,
                    )
                }
                PreviewControlButton(app.previews, previewId, Modifier.align(Alignment.BottomEnd).padding(16.dp))
            }
            val d = detail
            when {
                d != null -> Content(app, d, season, { season = it }, tab, { tab = it }, open)
                error != null -> EmptyState(Icons.Filled.Warning, "Couldn't load this title", error, Modifier.padding(top = 40.dp))
                else -> Loading(Modifier.fillMaxWidth().padding(top = 60.dp))
            }
        }
        // Back button floating over the artwork.
        Box(
            Modifier
                .statusBarsPadding()
                .padding(8.dp)
                .size(40.dp)
                .clip(CircleShape)
                .background(Color.Black.copy(alpha = 0.45f))
                .clickable(onClick = onBack),
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Color.White) }
    }
}

/** The episode/file Continue Watching points at, if any. */
private fun resumeEpisode(app: AppModel, d: TitleDetail): EpisodeDTO? {
    val item = app.continueItems.firstOrNull { it.titleId == d.id } ?: return null
    return d.seasons.flatMap { it.episodes }.firstOrNull { it.fileId == item.fileId }
}

@Composable
private fun Content(
    app: AppModel,
    d: TitleDetail,
    season: Int?,
    setSeason: (Int) -> Unit,
    tab: DetailTab,
    setTab: (DetailTab) -> Unit,
    open: OpenTitle,
) {
    Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 30.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(d.name, fontSize = 26.sp, fontWeight = FontWeight.Bold)
        MetaLine(d.rating, d.year, d.maturity, Format.length(d.kind, d.runtime, d.seasonCount, d.episodeCount), d.quality, fontSize = 14)
        PlayButtons(app, d)
        d.tagline?.takeIf { it.isNotEmpty() }?.let { Text(it, fontSize = 14.sp, fontStyle = FontStyle.Italic, color = Hb.secondaryText) }
        Text(d.overview, fontSize = 14.sp)
        Credits(d)
        Actions(app, d)
        if (d.seasons.isNotEmpty() || d.similar.isNotEmpty()) Tabs(app, d, season, setSeason, tab, setTab, open)
        About(d)
    }
}

@Composable
private fun PlayButtons(app: AppModel, d: TitleDetail) {
    val item = app.continueItems.firstOrNull { it.titleId == d.id }
    val fileId = item?.fileId ?: d.playFileId
    val progress = fileId?.let { app.progress(it) }
    val resuming = progress?.let { !it.finished && it.position > 15 } ?: false
    val episode = resumeEpisode(app, d)
    var label = if (resuming) "Resume" else "Play"
    if (episode != null && (d.kind == TitleKind.SHOW || d.episodeCount > 1)) label += " ${episode.code}"
    val available = d.available ?: true
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        PrimaryButton(label, Modifier.fillMaxWidth(), Icons.Filled.PlayArrow, enabled = fileId != null && available) {
            fileId?.let { app.play(it, d.id) }
        }
        if (progress != null && resuming && progress.duration > 0) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ProgressBar((progress.position / progress.duration).toFloat(), Modifier.weight(1f).clip(RoundedCornerShape(2.dp)))
                Text(Format.progressLabel(progress.position, progress.duration) ?: "", fontSize = 12.sp, color = Hb.secondaryText)
            }
            SecondaryButton("Play from Beginning", Modifier.fillMaxWidth(), Icons.Filled.SkipPrevious) {
                fileId?.let { app.play(it, d.id, fromStart = true) }
            }
        }
        if (!available) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.CloudOff, null, tint = Hb.secondaryText, modifier = Modifier.size(16.dp))
                Text("The drive or share with this title is offline.", fontSize = 13.sp, color = Hb.secondaryText)
            }
        }
    }
}

@Composable
private fun Credits(d: TitleDetail) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        if (d.cast.isNotEmpty()) LabelLine("Cast: ", d.cast.take(4).joinToString(", ") { it.name }, 12, maxLines = 2)
        val makers = if (d.kind == TitleKind.SHOW) d.creators else d.directors
        if (makers.isNotEmpty()) LabelLine(if (d.kind == TitleKind.SHOW) "Creators: " else "Director: ", makers.take(3).joinToString(", "), 12, maxLines = 2)
    }
}

@Composable
private fun LabelLine(label: String, value: String, size: Int, maxLines: Int = Int.MAX_VALUE, valueColor: Color = Hb.secondaryText) {
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = Hb.tertiaryText)) { append(label) }
            withStyle(SpanStyle(color = valueColor)) { append(value) }
        },
        fontSize = size.sp, maxLines = maxLines, overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun Actions(app: AppModel, d: TitleDetail) {
    val context = LocalContext.current
    val rating = app.rating(d.id)
    var rateMenu by remember { mutableStateOf(false) }
    Row(horizontalArrangement = Arrangement.spacedBy(20.dp), modifier = Modifier.padding(vertical = 6.dp)) {
        IconAction(if (app.isInList(d.id)) Icons.Filled.Check else Icons.Filled.Add, "My List") { app.toggleList(d.id) }
        Box {
            val icon = when (rating) {
                -1 -> Icons.Filled.ThumbDown
                1 -> Icons.Filled.ThumbUp
                2 -> Icons.Filled.Favorite
                else -> Icons.Outlined.ThumbUp
            }
            IconAction(icon, "Rate") { rateMenu = true }
            DropdownMenu(expanded = rateMenu, onDismissRequest = { rateMenu = false }) {
                DropdownMenuItem(
                    text = { Text("Not for me") },
                    leadingIcon = { Icon(if (rating == -1) Icons.Filled.ThumbDown else Icons.Outlined.ThumbDown, null) },
                    onClick = { rateMenu = false; app.rate(d.id, -1) },
                )
                DropdownMenuItem(
                    text = { Text("I like this") },
                    leadingIcon = { Icon(if (rating == 1) Icons.Filled.ThumbUp else Icons.Outlined.ThumbUp, null) },
                    onClick = { rateMenu = false; app.rate(d.id, 1) },
                )
                DropdownMenuItem(
                    text = { Text("Love this!") },
                    leadingIcon = { Icon(if (rating == 2) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder, null) },
                    onClick = { rateMenu = false; app.rate(d.id, 2) },
                )
            }
        }
        IconAction(Icons.AutoMirrored.Filled.Send, "Share") {
            val text = "${d.name}${d.year?.let { " ($it)" } ?: ""} — on Home Blockbuster"
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            context.startActivity(Intent.createChooser(send, null))
        }
    }
}

@Composable
private fun Tabs(
    app: AppModel,
    d: TitleDetail,
    season: Int?,
    setSeason: (Int) -> Unit,
    tab: DetailTab,
    setTab: (DetailTab) -> Unit,
    open: OpenTitle,
) {
    Column(Modifier.padding(top = 6.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
            if (d.seasons.isNotEmpty()) TabButton("Episodes", tab == DetailTab.EPISODES) { setTab(DetailTab.EPISODES) }
            if (d.similar.isNotEmpty()) TabButton("More Like This", tab == DetailTab.SIMILAR) { setTab(DetailTab.SIMILAR) }
        }
        HorizontalDivider(color = Color.White.copy(alpha = 0.2f))
        if (tab == DetailTab.EPISODES && d.seasons.isNotEmpty()) Episodes(app, d, season, setSeason) else Similar(app, d, open)
    }
}

@Composable
private fun TabButton(title: String, selected: Boolean, onClick: () -> Unit) {
    Column(Modifier.width(IntrinsicSize.Max).clickable(onClick = onClick), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().height(4.dp).background(if (selected) Hb.red else Color.Transparent))
        Text(title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = if (selected) Color.White else Hb.secondaryText)
    }
}

@Composable
private fun Episodes(app: AppModel, d: TitleDetail, season: Int?, setSeason: (Int) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    if (d.seasons.size > 1) {
        Box {
            Row(
                Modifier.clip(RoundedCornerShape(4.dp)).background(Hb.surfaceHigh).clickable { menu = true }.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(d.seasons.firstOrNull { it.number == season }?.name ?: "Season", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                Icon(Icons.Filled.KeyboardArrowDown, null, tint = Color.White, modifier = Modifier.size(18.dp))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                for (s in d.seasons) DropdownMenuItem(text = { Text(s.name) }, onClick = { menu = false; setSeason(s.number) })
            }
        }
    }
    val list = (d.seasons.firstOrNull { it.number == season } ?: d.seasons.firstOrNull())?.episodes ?: emptyList()
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        for (ep in list) EpisodeRow(app, ep, d.id, d.images.wide)
    }
}

@Composable
private fun EpisodeRow(app: AppModel, episode: EpisodeDTO, titleId: String, fallbackArt: String?) {
    val progress = app.progress(episode.fileId)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            Modifier.fillMaxWidth().clickable { app.play(episode.fileId, titleId) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.width(130.dp).height(73.dp).clip(RoundedCornerShape(3.dp)), contentAlignment = Alignment.Center) {
                RemoteImage(episode.still ?: fallbackArt, Modifier.fillMaxSize())
                PlayCircle(34.dp)
                if (progress != null && progress.duration > 0) {
                    ProgressBar(
                        if (progress.finished) 1f else (progress.position / progress.duration).toFloat(),
                        Modifier.fillMaxWidth().align(Alignment.BottomCenter),
                        track = Color.White.copy(alpha = 0.3f),
                    )
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("${episode.episode}. ${episode.name}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Format.runtime(episode.runtime ?: episode.duration?.div(60))?.let { Text(it, fontSize = 12.sp, color = Hb.secondaryText) }
            }
        }
        if (episode.overview.isNotEmpty()) {
            Text(episode.overview, fontSize = 12.sp, color = Hb.secondaryText, maxLines = 4, overflow = TextOverflow.Ellipsis)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Similar(app: AppModel, d: TitleDetail, open: OpenTitle) {
    val items = d.similar.mapNotNull { app.titleMap[it] }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 3) {
        for (t in items) {
            Box(Modifier.weight(1f)) { PosterCard(t, width = 400.dp, onClick = { open(t.id) }) }
        }
        // Keep the last row's posters the same size as the others.
        repeat((3 - items.size % 3) % 3) { Box(Modifier.weight(1f)) }
    }
}

@Composable
private fun About(d: TitleDetail) {
    Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("About ${d.name}", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 4.dp))
        if (d.cast.isNotEmpty()) LabelLine("Cast: ", d.cast.take(10).joinToString(", ") { it.name }, 13, valueColor = Color.White)
        if (d.directors.isNotEmpty()) LabelLine("Director: ", d.directors.joinToString(", "), 13, valueColor = Color.White)
        if (d.creators.isNotEmpty()) LabelLine("Creators: ", d.creators.joinToString(", "), 13, valueColor = Color.White)
        if (d.writers.isNotEmpty()) LabelLine("Writers: ", d.writers.take(5).joinToString(", "), 13, valueColor = Color.White)
        if (d.genres.isNotEmpty()) LabelLine("Genres: ", d.genres.joinToString(", "), 13, valueColor = Color.White)
        if (d.tags.isNotEmpty()) LabelLine("This title is: ", d.tags.take(5).joinToString(", "), 13, valueColor = Color.White)
        if (d.studios.isNotEmpty()) LabelLine("Studio: ", d.studios.take(3).joinToString(", "), 13, valueColor = Color.White)
        d.maturity?.let { LabelLine("Maturity rating: ", it, 13, valueColor = Color.White) }
    }
}
