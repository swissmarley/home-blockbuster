package com.swissmarley.homeblockbuster.util

import com.swissmarley.homeblockbuster.data.ContinueItem
import com.swissmarley.homeblockbuster.data.ProfileState
import com.swissmarley.homeblockbuster.data.TitleKind
import com.swissmarley.homeblockbuster.data.TitleSummary
import java.text.Normalizer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.log10

/** Home-screen rows, ported from web/src/lib/rows.ts (via the iOS app) so every client feels the same. */
data class RowDef(
    val id: String,
    val title: String,
    val style: Style,
    val items: List<TitleSummary>,
    val continueItems: List<ContinueItem> = emptyList(),
) {
    enum class Style { STANDARD, TOP10, CONTINUE }
}

enum class BrowseFilter(val label: String) {
    ALL("Home"), SHOW("TV Shows"), MOVIE("Movies");

    fun matches(kind: TitleKind): Boolean = when (this) {
        ALL -> true
        SHOW -> kind == TitleKind.SHOW
        MOVIE -> kind == TitleKind.MOVIE
    }
}

object Rows {
    private const val ROW_LIMIT = 40

    private val genreNames: Map<String, Triple<String, String, String>> = mapOf(
        "action" to Triple("Action & Adventure", "Action Movies", "Action TV"),
        "action & adventure" to Triple("Action & Adventure", "Action & Adventure Movies", "Action & Adventure TV"),
        "adventure" to Triple("Adventures", "Adventure Movies", "Adventure TV"),
        "animation" to Triple("Animation", "Animated Movies", "Animated TV"),
        "anime" to Triple("Anime", "Anime Movies", "Anime Series"),
        "comedy" to Triple("Comedies", "Comedy Movies", "TV Comedies"),
        "crime" to Triple("Crime", "Crime Movies", "Crime TV Shows"),
        "documentary" to Triple("Documentaries", "Documentary Films", "Docuseries"),
        "drama" to Triple("Dramas", "Drama Movies", "TV Dramas"),
        "family" to Triple("Family Time", "Family Movies", "Family TV"),
        "fantasy" to Triple("Fantasy", "Fantasy Movies", "Fantasy TV"),
        "history" to Triple("History", "Historical Movies", "Historical TV"),
        "horror" to Triple("Horror", "Horror Movies", "Horror TV Shows"),
        "kids" to Triple("Kids", "Kids Movies", "Kids TV"),
        "music" to Triple("Music & Musicals", "Music & Musicals", "Music TV"),
        "mystery" to Triple("Mysteries", "Mystery Movies", "Mystery TV"),
        "romance" to Triple("Romance", "Romantic Movies", "Romantic TV Shows"),
        "science fiction" to Triple("Sci-Fi", "Sci-Fi Movies", "Sci-Fi TV"),
        "sci-fi & fantasy" to Triple("Sci-Fi & Fantasy", "Sci-Fi & Fantasy Movies", "Sci-Fi & Fantasy TV"),
        "thriller" to Triple("Thrillers", "Thriller Movies", "TV Thrillers"),
        "war" to Triple("War", "War Movies", "War TV"),
        "war & politics" to Triple("War & Politics", "War Movies", "War & Politics TV"),
        "western" to Triple("Westerns", "Westerns", "Western TV"),
        "reality" to Triple("Reality TV", "Reality", "Reality TV"),
        "tv movie" to Triple("TV Movies", "TV Movies", "TV Movies"),
    )

    fun genreTitle(genre: String, filter: BrowseFilter): String {
        val names = genreNames[genre.lowercase()] ?: return genre
        return when (filter) {
            BrowseFilter.ALL -> names.first
            BrowseFilter.MOVIE -> names.second
            BrowseFilter.SHOW -> names.third
        }
    }

    fun trendScore(t: TitleSummary): Double = (t.rating ?: 5.0) * 2 + log10(1 + (t.popularity ?: 0.0)) * 3

    /** FNV-1a over UTF-16 code units, identical to the web and iOS apps. */
    private fun hash(s: String): UInt {
        var h = 2_166_136_261u
        for (c in s) h = (h xor c.code.toUInt()) * 16_777_619u
        return h
    }

    private val today: String
        get() = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())

    private fun dailyShuffle(items: List<TitleSummary>): List<TitleSummary> {
        val day = today
        return items.sortedBy { hash(it.id + day) }
    }

    private fun overlap(a: TitleSummary, b: TitleSummary): Int =
        a.genres.count { it in b.genres } * 2 + a.tags.count { it in b.tags }

    private fun isRated(t: TitleSummary): Boolean = (t.rating ?: 0.0) > 0 || (t.popularity ?: 0.0) > 0

    fun build(
        all: List<TitleSummary>,
        titleMap: Map<String, TitleSummary>,
        state: ProfileState?,
        allContinue: List<ContinueItem>,
        profileName: String,
        filter: BrowseFilter,
    ): List<RowDef> {
        val titles = all.filter { filter.matches(it.kind) }
        val inScope: (TitleSummary?) -> Boolean = { it != null && filter.matches(it.kind) }
        val rows = mutableListOf<RowDef>()
        fun add(row: RowDef, min: Int = 1) {
            val r = row.copy(items = row.items.take(if (row.style == RowDef.Style.TOP10) 10 else ROW_LIMIT))
            if (r.items.size >= min) rows += r
        }

        val continueItems = allContinue.filter { inScope(titleMap[it.titleId]) }
        if (continueItems.isNotEmpty()) {
            rows += RowDef(
                "continue", "Continue Watching for $profileName", RowDef.Style.CONTINUE,
                continueItems.mapNotNull { titleMap[it.titleId] }, continueItems,
            )
        }
        if (state != null && state.myList.isNotEmpty()) {
            add(RowDef("mylist", "My List", RowDef.Style.STANDARD, state.myList.mapNotNull { titleMap[it] }.filter(inScope)))
        }

        val byAdded = titles.sortedByDescending { it.addedAt }
        val recent = byAdded.filter { Format.isRecentlyAdded(it.addedAt, 30.0) }
        add(RowDef("new", "New on Home Blockbuster", RowDef.Style.STANDARD, if (recent.size >= 4) recent else byAdded))

        val top: (List<TitleSummary>) -> List<TitleSummary> = { list -> list.sortedByDescending { trendScore(it) } }
        val movies = titles.filter { it.kind == TitleKind.MOVIE && isRated(it) }
        val shows = titles.filter { it.kind == TitleKind.SHOW && isRated(it) }
        if (filter != BrowseFilter.SHOW && movies.size >= 10) {
            add(RowDef("top-movies", "Top 10 Movies in Your Library Today", RowDef.Style.TOP10, top(movies)), min = 10)
        }
        val rated = titles.filter(::isRated)
        add(RowDef("trending", "Trending Now", RowDef.Style.STANDARD, dailyShuffle(top(rated).take(30))), min = 4)

        val last = allContinue.firstOrNull()
        val anchor = last?.let { titleMap[it.titleId] }
        if (anchor != null) {
            val similar = titles.asSequence()
                .filter { it.id != anchor.id }
                .map { it to overlap(anchor, it) }
                .filter { it.second > 0 }
                .sortedWith(compareByDescending<Pair<TitleSummary, Int>> { it.second }.thenByDescending { it.first.rating ?: 0.0 })
                .map { it.first }
                .toList()
            add(RowDef("because", "Because You Watched ${anchor.name}", RowDef.Style.STANDARD, similar), min = 3)
        }
        if (filter != BrowseFilter.MOVIE && shows.size >= 10) {
            add(RowDef("top-shows", "Top 10 TV Shows in Your Library Today", RowDef.Style.TOP10, top(shows)), min = 10)
        }

        val genreCounts = mutableMapOf<String, Int>()
        for (t in titles) for (g in t.genres) genreCounts[g] = (genreCounts[g] ?: 0) + 1
        val genres = genreCounts.entries
            .filter { it.value >= 2 }
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .take(12)
            .map { it.key }
        val genreRows = genres.map { g ->
            RowDef("genre-$g", genreTitle(g, filter), RowDef.Style.STANDARD, dailyShuffle(titles.filter { g in it.genres }))
        }

        val acclaimed = titles.filter { (it.rating ?: 0.0) >= 7.5 }.sortedByDescending { it.rating ?: 0.0 }
        val watchedIds = mutableListOf<String>()
        for (p in (state?.progress?.values ?: emptyList()).sortedByDescending { it.updatedAt }) {
            if (p.finished && p.titleId !in watchedIds) watchedIds += p.titleId
        }
        val watchAgain = watchedIds.mapNotNull { titleMap[it] }.filter(inScope)
        val curated = mutableListOf(
            RowDef("acclaimed", "Critically Acclaimed", RowDef.Style.STANDARD, acclaimed),
            RowDef("again", "Watch It Again", RowDef.Style.STANDARD, watchAgain),
        )
        val decades = sortedMapOf<Int, MutableList<TitleSummary>>(reverseOrder())
        for (t in titles) {
            val y = t.year ?: continue
            val d = y / 10 * 10
            if (d in 1950..2000) decades.getOrPut(d) { mutableListOf() } += t
        }
        for ((d, list) in decades) {
            if (list.size >= 4) {
                curated += RowDef(
                    "decade-$d", "${d.toString().takeLast(2)}s ${if (filter == BrowseFilter.SHOW) "TV" else "Favorites"}",
                    RowDef.Style.STANDARD, list,
                )
            }
        }
        val mixed = mutableListOf<RowDef>()
        for (i in 0 until maxOf(genreRows.size, curated.size)) {
            if (i * 2 < genreRows.size) mixed += genreRows[i * 2]
            if (i * 2 + 1 < genreRows.size) mixed += genreRows[i * 2 + 1]
            if (i < curated.size) mixed += curated[i]
        }
        for (row in mixed) add(row, min = if (row.id.startsWith("genre")) 2 else 3)

        val alpha: (List<TitleSummary>) -> List<TitleSummary> = { list -> list.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.name }) }
        if (filter == BrowseFilter.ALL) {
            add(RowDef("all-shows", "TV Shows", RowDef.Style.STANDARD, alpha(titles.filter { it.kind == TitleKind.SHOW })))
            add(RowDef("all-movies", "Movies", RowDef.Style.STANDARD, alpha(titles.filter { it.kind == TitleKind.MOVIE })))
        } else {
            add(RowDef("all", if (filter == BrowseFilter.SHOW) "All TV Shows" else "All Movies", RowDef.Style.STANDARD, alpha(titles)))
        }

        val seen = mutableSetOf<String>()
        return rows.filter { row ->
            if (row.style == RowDef.Style.CONTINUE) true
            else seen.add(row.items.map { it.id }.sorted().joinToString(","))
        }
    }

    fun billboard(titles: List<TitleSummary>, seed: String): TitleSummary? {
        val withArt = titles.filter { it.images.backdrop != null || it.images.thumb != null || it.images.poster != null }
        val pool = withArt.ifEmpty { titles }
        if (pool.isEmpty()) return null
        fun score(t: TitleSummary): Double =
            trendScore(t) + (if (Format.isRecentlyAdded(t.addedAt, 21.0)) 4 else 0) +
                (if (t.images.logo != null) 2 else 0) + (if (t.images.backdrop != null) 3 else 0)
        val top = pool.sortedByDescending(::score).take(8)
        return top[(hash(seed) % top.size.toUInt()).toInt()]
    }

    private val nonAlnum = Regex("[^\\p{L}\\p{N}]+")
    private val marks = Regex("\\p{M}+")

    private fun norm(s: String): String {
        val folded = marks.replace(Normalizer.normalize(s, Normalizer.Form.NFD), "").lowercase()
        return nonAlnum.replace(folded, " ").trim()
    }

    fun search(titles: List<TitleSummary>, query: String): List<TitleSummary> {
        val q = norm(query)
        if (q.isEmpty()) return emptyList()
        val tokens = q.split(" ").filter { it.isNotEmpty() }
        fun words(s: String) = s.split(" ")
        fun has(hay: String, token: String): Boolean =
            if (token.length > 1) hay.contains(token) else words(hay).any { it.startsWith(token) }

        val scored = mutableListOf<Pair<TitleSummary, Double>>()
        for (t in titles) {
            val name = norm(t.name)
            val people = t.people.map(::norm)
            val genres = (t.genres + t.tags).map(::norm)
            val overview = norm(t.overview)
            var score = 0.0
            if (name == q) score += 100 else if (name.startsWith(q)) score += 60 else if (name.contains(q)) score += 40
            for (token in tokens) {
                if (words(name).any { it.startsWith(token) }) score += 10
                if (people.any { p -> words(p).any { it.startsWith(token) } }) score += 8
                if (genres.any { has(it, token) }) score += 6
                if (token.length > 2 && overview.contains(token)) score += 2
            }
            if (q in people) score += 30
            val allMatch = tokens.all { tok ->
                has(name, tok) || people.any { has(it, tok) } || genres.any { has(it, tok) } || has(overview, tok)
            }
            if (score > 0 && allMatch) scored += t to (score + trendScore(t) / 10)
        }
        return scored.sortedByDescending { it.second }.map { it.first }
    }
}
