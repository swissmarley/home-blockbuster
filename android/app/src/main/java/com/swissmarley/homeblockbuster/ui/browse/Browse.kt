package com.swissmarley.homeblockbuster.ui.browse

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LibraryAdd
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.swissmarley.homeblockbuster.data.TitleSummary
import com.swissmarley.homeblockbuster.state.AppModel
import com.swissmarley.homeblockbuster.ui.components.Avatar
import com.swissmarley.homeblockbuster.ui.components.EmptyState
import com.swissmarley.homeblockbuster.ui.components.Loading
import com.swissmarley.homeblockbuster.ui.components.LogoMark
import com.swissmarley.homeblockbuster.ui.components.PrimaryButton
import com.swissmarley.homeblockbuster.ui.components.RemoteImage
import com.swissmarley.homeblockbuster.ui.components.SecondaryButton
import com.swissmarley.homeblockbuster.ui.detail.TitleDetailScreen
import com.swissmarley.homeblockbuster.ui.settings.SettingsScreen
import com.swissmarley.homeblockbuster.ui.theme.Hb
import com.swissmarley.homeblockbuster.util.BrowseFilter
import com.swissmarley.homeblockbuster.util.RowDef
import com.swissmarley.homeblockbuster.util.Rows
import kotlinx.coroutines.launch
import java.util.Calendar

/** Open a title page in the current tab. */
typealias OpenTitle = (String) -> Unit

private data class Tab(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val tabs = listOf(
    Tab("Home", Icons.Filled.Home),
    Tab("Search", Icons.Filled.Search),
    Tab("My List", Icons.Filled.LibraryAdd),
    Tab("Profile", Icons.Filled.Movie),
)

@Composable
fun MainTabs(app: AppModel) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val stacks = remember { List(tabs.size) { mutableStateListOf<String>() } }
    val holder = rememberSaveableStateHolder()
    val stack = stacks[tab]
    val open: OpenTitle = { id -> stacks[tab].add(id) }

    BackHandler(enabled = stack.isNotEmpty() || tab != 0) {
        if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) else tab = 0
    }

    Scaffold(
        containerColor = Hb.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            NavigationBar(containerColor = Color.Black.copy(alpha = 0.95f)) {
                tabs.forEachIndexed { i, t ->
                    NavigationBarItem(
                        selected = tab == i,
                        onClick = {
                            // Tapping the current tab again goes back to its root.
                            if (tab == i) stacks[i].clear() else tab = i
                        },
                        icon = {
                            if (i == 3) Avatar(app.profile?.avatar ?: "smile-blue", Modifier.size(24.dp), cornerRadius = 12f)
                            else Icon(t.icon, t.label)
                        },
                        label = { Text(t.label, fontSize = 11.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = Color.White,
                            selectedTextColor = Color.White,
                            unselectedIconColor = Hb.tertiaryText,
                            unselectedTextColor = Hb.tertiaryText,
                            indicatorColor = Color.White.copy(alpha = 0.12f),
                        ),
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(bottom = padding.calculateBottomPadding())) {
            val top = stack.lastOrNull()
            val entryKey = if (top != null) "t$tab-${stack.size}-$top" else "t$tab-root"
            key(entryKey) {
                holder.SaveableStateProvider(entryKey) {
                    when {
                        top != null -> TitleDetailScreen(app, top, open, onBack = { stack.removeAt(stack.lastIndex) })
                        tab == 0 -> HomeScreen(app, open)
                        tab == 1 -> SearchScreen(app, open)
                        tab == 2 -> MyListScreen(app, open)
                        else -> SettingsScreen(app)
                    }
                }
            }
        }
    }
}

// region Home

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(app: AppModel, open: OpenTitle) {
    var filter by rememberSaveable { mutableStateOf(BrowseFilter.ALL) }
    var peek by remember { mutableStateOf<TitleSummary?>(null) }
    var refreshing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    val scrolled by remember { derivedStateOf { list.firstVisibleItemIndex > 0 || list.firstVisibleItemScrollOffset > 40 } }
    val headerAlpha by animateFloatAsState(if (scrolled) 1f else 0f, label = "header")

    val rows = remember(app.titles, app.state, app.continueItems, filter, app.profile?.name) {
        Rows.build(app.titles, app.titleMap, app.state, app.continueItems, app.profile?.name ?: "You", filter)
    }
    val hero = remember(app.titles, filter, app.profile?.id) {
        val day = Calendar.getInstance().get(Calendar.DAY_OF_MONTH)
        Rows.billboard(app.titles.filter { filter.matches(it.kind) }, "${app.profile?.id ?: ""}-${filter.name.lowercase()}-$day")
    }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch { app.reloadLibrary(); refreshing = false }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(state = list, modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(26.dp)) {
            if (hero != null) item(key = "hero") { Billboard(app, hero, open) }
            else item(key = "spacer") { Spacer(Modifier.statusBarsPadding().height(110.dp)) }
            items(rows, key = { it.id }) { row -> RowSection(app, row, open, onPeek = { peek = it }) }
            if (!app.libraryLoading && app.titles.isEmpty()) {
                item(key = "empty") {
                    val err = app.libraryError
                    EmptyState(
                        if (err == null) Icons.Filled.Movie else Icons.Filled.WifiOff,
                        if (err == null) "Nothing here yet" else "Couldn't load your library",
                        err ?: "Add a library on the server in Settings → Libraries (from a browser), then pull down to refresh.",
                        Modifier.padding(top = 40.dp),
                        actionLabel = "Try Again",
                        onAction = { scope.launch { app.reloadLibrary() } },
                    )
                }
            }
            item(key = "bottom") { Spacer(Modifier.height(20.dp)) }
        }

        // Top bar over the billboard: transparent at first, solid once the page scrolls.
        Column(
            Modifier
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.85f), Color.Transparent)))
                .background(Hb.background.copy(alpha = 0.92f * headerAlpha))
                .statusBarsPadding()
                .padding(horizontal = 16.dp)
                .padding(bottom = 10.dp, top = 4.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                LogoMark(Modifier.size(34.dp))
                Spacer(Modifier.weight(1f))
                ProfileBadge(app)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                for (f in listOf(BrowseFilter.SHOW, BrowseFilter.MOVIE)) {
                    Text(
                        f.label,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier
                            .clip(RoundedCornerShape(50))
                            .background(if (filter == f) Color.White.copy(alpha = 0.25f) else Color.Transparent)
                            .border(1.dp, Color.White.copy(alpha = 0.45f), RoundedCornerShape(50))
                            .clickable { filter = if (filter == f) BrowseFilter.ALL else f }
                            .padding(horizontal = 14.dp, vertical = 7.dp),
                    )
                }
                if (filter != BrowseFilter.ALL) {
                    Box(
                        Modifier.size(30.dp).clip(CircleShape).border(1.dp, Color.White.copy(alpha = 0.45f), CircleShape)
                            .clickable { filter = BrowseFilter.ALL },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Close, "Show everything", tint = Color.White, modifier = Modifier.size(14.dp)) }
                }
            }
        }

        if (app.libraryLoading && app.titles.isEmpty()) Loading(Modifier.fillMaxSize())
    }

    peek?.let { t -> TitlePeek(app, t, onDismiss = { peek = null }, onInfo = { open(t.id) }) }
}

@Composable
fun ProfileBadge(app: AppModel) {
    Avatar(
        app.profile?.avatar ?: "smile-blue",
        Modifier.size(30.dp).clip(RoundedCornerShape(5.dp)).clickable { app.switchProfile() },
        cornerRadius = 10f,
    )
}

@Composable
private fun Billboard(app: AppModel, title: TitleSummary, open: OpenTitle) {
    Box(Modifier.fillMaxWidth().height(560.dp).clipToBounds(), contentAlignment = Alignment.BottomCenter) {
        RemoteImage(title.images.poster ?: title.images.hero, Modifier.fillMaxSize())
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = 0.5f), 0.25f to Color.Transparent, 0.5f to Color.Transparent, 1f to Hb.background,
                )
            )
        )
        Column(
            Modifier.padding(horizontal = 24.dp).padding(bottom = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            val logo = title.images.logo
            if (logo != null) {
                RemoteImage(logo, Modifier.widthIn(max = 260.dp).fillMaxWidth().heightIn(max = 110.dp).height(110.dp), ContentScale.Fit, Color.Transparent)
            } else {
                Text(
                    title.name, fontSize = 38.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center,
                    style = TextStyle(shadow = Shadow(Color.Black, blurRadius = 16f)),
                )
            }
            Text(title.genres.take(3).joinToString(" • "), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.9f))
            Row(Modifier.widthIn(max = 360.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val target = app.playTarget(title)
                PrimaryButton("Play", Modifier.weight(1f), Icons.Filled.PlayArrow, enabled = target != null && title.isAvailable) {
                    target?.let { app.play(it, title.id) }
                }
                SecondaryButton("My List", Modifier.weight(1f), if (app.isInList(title.id)) Icons.Filled.Check else Icons.Filled.Add) {
                    app.toggleList(title.id)
                }
            }
            Row(
                Modifier.clip(RoundedCornerShape(6.dp)).clickable { open(title.id) }.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(Icons.Filled.Info, null, tint = Color.White, modifier = Modifier.size(18.dp))
                Text("Info", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun RowSection(app: AppModel, row: RowDef, open: OpenTitle, onPeek: (TitleSummary) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(row.title, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 16.dp))
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(if (row.style == RowDef.Style.TOP10) 4.dp else 8.dp),
        ) {
            when (row.style) {
                RowDef.Style.CONTINUE -> items(row.continueItems, key = { it.titleId }) { item ->
                    ContinueCard(app, item, onInfo = { open(item.titleId) })
                }
                RowDef.Style.TOP10 -> itemsIndexed(row.items, key = { _, t -> t.id }) { i, t ->
                    Top10Card(i + 1, t, onClick = { open(t.id) }, onLongClick = { onPeek(t) })
                }
                RowDef.Style.STANDARD -> items(row.items, key = { it.id }) { t ->
                    PosterCard(t, onClick = { open(t.id) }, onLongClick = { onPeek(t) })
                }
            }
        }
    }
}

// endregion

// region Search & My List

@Composable
fun SearchScreen(app: AppModel, open: OpenTitle) {
    var query by rememberSaveable { mutableStateOf("") }
    val results = remember(query, app.titles) { Rows.search(app.titles, query) }
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Text("Search", fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 8.dp))
        TextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Titles, people, genres") },
            leadingIcon = { Icon(Icons.Filled.Search, null) },
            trailingIcon = {
                if (query.isNotEmpty()) Icon(Icons.Filled.Close, "Clear", Modifier.clickable { query = "" })
            },
            singleLine = true,
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false),
            shape = RoundedCornerShape(10.dp),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Hb.surface, unfocusedContainerColor = Hb.surface,
                focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
            ),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        if (query.isBlank()) {
            val top = remember(app.titles) { app.titles.sortedByDescending(Rows::trendScore).take(20) }
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
                item { Text("Top Searches", fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(16.dp)) }
                items(top, key = { it.id }) { t ->
                    Row(
                        Modifier.fillMaxWidth().clickable { open(t.id) }.padding(horizontal = 16.dp, vertical = 3.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        RemoteImage(t.images.wide ?: t.images.poster, Modifier.width(130.dp).height(73.dp).clip(RoundedCornerShape(3.dp)))
                        Text(t.name, Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Icon(Icons.Outlined.PlayCircle, null, tint = Color.White, modifier = Modifier.size(30.dp))
                    }
                }
            }
        } else if (results.isEmpty()) {
            EmptyState(Icons.Filled.Search, "No results for “$query”", "Check the spelling or try a new search.", Modifier.padding(top = 60.dp))
        } else {
            PosterGrid(results, open)
        }
    }
}

@Composable
private fun PosterGrid(items: List<TitleSummary>, open: OpenTitle, onLongClick: ((TitleSummary) -> Unit)? = null) {
    LazyVerticalGrid(
        columns = GridCells.Adaptive(104.dp),
        contentPadding = PaddingValues(16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        items(items, key = { it.id }) { t ->
            Box(Modifier.fillMaxWidth()) {
                PosterCard(t, width = 400.dp, onClick = { open(t.id) }, onLongClick = onLongClick?.let { { it(t) } })
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyListScreen(app: AppModel, open: OpenTitle) {
    val items = app.state.myList.mapNotNull { app.titleMap[it] }
    var refreshing by remember { mutableStateOf(false) }
    var peek by remember { mutableStateOf<TitleSummary?>(null) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("My List", fontSize = 30.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            ProfileBadge(app)
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                scope.launch { app.refreshProfileState(); refreshing = false }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            if (items.isEmpty()) {
                LazyColumn(Modifier.fillMaxSize()) {
                    item {
                        EmptyState(Icons.Filled.LibraryAdd, "Your list is empty", "Tap My List on any title to save it here.", Modifier.padding(top = 80.dp))
                    }
                }
            } else {
                PosterGrid(items, open, onLongClick = { peek = it })
            }
        }
    }
    peek?.let { t -> TitlePeek(app, t, onDismiss = { peek = null }, onInfo = { open(t.id) }) }
}

// endregion
