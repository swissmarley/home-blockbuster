package com.swissmarley.homeblockbuster.screenshots

import com.swissmarley.homeblockbuster.data.CastMember
import com.swissmarley.homeblockbuster.data.ContinueItem
import com.swissmarley.homeblockbuster.data.EpisodeDTO
import com.swissmarley.homeblockbuster.data.ImageSet
import com.swissmarley.homeblockbuster.data.PlaybackInfo
import com.swissmarley.homeblockbuster.data.PlaybackMode
import com.swissmarley.homeblockbuster.data.ProfileDTO
import com.swissmarley.homeblockbuster.data.ProfileState
import com.swissmarley.homeblockbuster.data.ProgressEntry
import com.swissmarley.homeblockbuster.data.SeasonDTO
import com.swissmarley.homeblockbuster.data.SubtitleTrack
import com.swissmarley.homeblockbuster.data.TitleDetail
import com.swissmarley.homeblockbuster.data.TitleKind
import com.swissmarley.homeblockbuster.data.TitleSummary

/**
 * The invented library shown in the Play Store screenshots. Every name, person and image is fictional;
 * the artwork is drawn by android/play-store/demo_art.py with the same ids.
 */
object DemoLibrary {
    private val now = System.currentTimeMillis().toDouble()
    private const val DAY = 86_400_000.0

    private class Spec(
        val id: String,
        val name: String,
        val kind: TitleKind = TitleKind.MOVIE,
        val year: Int,
        val genres: List<String>,
        val rating: Double,
        val maturity: String,
        val runtime: Double,
        val quality: String = "HD",
        val addedDaysAgo: Double,
        val tagline: String,
        val overview: String,
        val cast: List<String>,
        val director: List<String>,
        val tags: List<String> = emptyList(),
    )

    private val specs = listOf(
        Spec(
            "last-lighthouse", "The Last Lighthouse", year = 2024, genres = listOf("Drama", "Mystery"), rating = 8.6, maturity = "12",
            runtime = 128.0, quality = "4K", addedDaysAgo = 2.0, tagline = "Some lights are kept for the ones who never came home.",
            overview = "When the last keeper of a storm-battered lighthouse vanishes, his estranged daughter returns to the island " +
                "and finds the lamp still burning — and a logbook written in a hand she knows too well.",
            cast = listOf("Mara Lindqvist", "Tobias Achterberg", "Inès Varga", "Callum Reyes", "Odile Brandt"),
            director = listOf("Helena Strand"), tags = listOf("Atmospheric", "Haunting"),
        ),
        Spec(
            "neon-harbor", "Neon Harbor", year = 2023, genres = listOf("Science Fiction", "Thriller"), rating = 8.1, maturity = "16",
            runtime = 117.0, quality = "4K", addedDaysAgo = 5.0, tagline = "The city never sleeps. Neither does the tide.",
            overview = "In a flooded megacity lit by a thousand signs, a harbor pilot smuggling memories across the bay is hired " +
                "for one last run — carrying something that remembers her.",
            cast = listOf("Yuna Okafor", "Dario Castellane", "Petra Holm", "Kenji Arvidsson"),
            director = listOf("Rafael Monteiro"), tags = listOf("Dark", "Stylish"),
        ),
        Spec(
            "saltwater-saints", "Saltwater Saints", year = 2022, genres = listOf("Crime", "Drama"), rating = 7.7, maturity = "16",
            runtime = 109.0, addedDaysAgo = 12.0, tagline = "Every fishing town has its secrets.",
            overview = "Three brothers running a failing trawler get one chance to save the family boat, if they're willing to fish " +
                "for something other than cod.",
            cast = listOf("Liam Carrow", "Eoin Malley", "Saoirse Quinlan"), director = listOf("Nils Bergkvist"),
        ),
        Spec(
            "paper-comets", "Paper Comets", year = 2021, genres = listOf("Family", "Adventure"), rating = 7.4, maturity = "6",
            runtime = 96.0, addedDaysAgo = 9.0, tagline = "Make a wish. Fold it carefully.",
            overview = "Two siblings discover that the paper comets they launch from their rooftop land somewhere very far away — " +
                "and someone is folding them back.",
            cast = listOf("Ada Pell", "Milo Sørensen", "Grace Ndiaye"), director = listOf("Tomás Ilić"),
        ),
        Spec(
            "glass-orchard", "The Glass Orchard", year = 2020, genres = listOf("Fantasy", "Romance"), rating = 7.9, maturity = "12",
            runtime = 112.0, addedDaysAgo = 30.0, tagline = "Handle with care.",
            overview = "A glassblower inherits an orchard whose fruit rings like bells at dawn, and a neighbor who swears it " +
                "has been keeping time for a hundred years.",
            cast = listOf("Céleste Moreau", "Anton Weiss", "Lucia Ferrante"), director = listOf("Ingrid Falk"),
        ),
        Spec(
            "midnight-cartographer", "Midnight Cartographer", year = 2024, genres = listOf("Adventure", "Mystery"), rating = 8.0,
            maturity = "12", runtime = 121.0, quality = "4K", addedDaysAgo = 1.0, tagline = "Some places only exist after dark.",
            overview = "A mapmaker who charts the mountains by starlight finds a valley that appears on none of her maps — " +
                "and only on nights without a moon.",
            cast = listOf("Noor Haddad", "Elias Brennan", "Freya Aalto"), director = listOf("Jonas Werner"),
        ),
        Spec(
            "static-bloom", "Static Bloom", year = 2022, genres = listOf("Science Fiction", "Drama"), rating = 7.2, maturity = "12",
            runtime = 104.0, addedDaysAgo = 40.0, tagline = "Something is growing on the signal.",
            overview = "A radio astronomer picks up a transmission that sounds like a garden growing, and the plants in her lab " +
                "begin to lean toward the dish.",
            cast = listOf("Hanna Vos", "Samuel Achebe", "Leni Kraus"), director = listOf("Matteo Rinaldi"),
        ),
        Spec(
            "copper-valley", "Copper Valley", year = 1998, genres = listOf("Western", "Drama"), rating = 7.6, maturity = "12",
            runtime = 131.0, addedDaysAgo = 60.0, tagline = "The mine is dry. The feud isn't.",
            overview = "A retired surveyor rides back into the valley he mapped forty years ago to settle a claim that two " +
                "families have fought over ever since.",
            cast = listOf("Walt Harlan", "June Castillo", "Ben Okoro"), director = listOf("Ruth McAllister"),
        ),
        Spec(
            "orbit-small-things", "Orbit of Small Things", year = 2019, genres = listOf("Science Fiction", "Drama"), rating = 8.3,
            maturity = "6", runtime = 99.0, addedDaysAgo = 50.0, tagline = "The universe is mostly details.",
            overview = "Aboard a cargo station at the edge of the solar system, a maintenance robot and a lonely engineer " +
                "start a collection of everything that drifts by.",
            cast = listOf("Priya Lund", "Oskar Feld", "Mae Tanaka"), director = listOf("Clara Benedetti"),
        ),
        Spec(
            "low-tide-radio", "Low Tide Radio", year = 2023, genres = listOf("Comedy", "Drama"), rating = 7.1, maturity = "12",
            runtime = 101.0, addedDaysAgo = 15.0, tagline = "Broadcasting live from the end of the pier.",
            overview = "The host of a seaside radio station with exactly eleven listeners decides to save it with the world's " +
                "longest live broadcast.",
            cast = listOf("Rosie Abernathy", "Felix Duarte", "Agnes Whitlow"), director = listOf("Paul Lindgren"),
        ),
        Spec(
            "hollow-pines", "Hollow Pines", year = 2021, genres = listOf("Horror", "Thriller"), rating = 6.9, maturity = "16",
            runtime = 94.0, addedDaysAgo = 22.0, tagline = "Don't answer the trees.",
            overview = "A forest ranger posted to a remote fire tower starts hearing her name called from the woods — in her " +
                "own voice.",
            cast = listOf("Tessa Morrow", "Isaac Lyle", "Dana Kirsch"), director = listOf("Viktor Halme"),
        ),
        Spec(
            "quiet-engine", "The Quiet Engine", year = 2020, genres = listOf("Thriller", "Science Fiction"), rating = 7.5, maturity = "16",
            runtime = 115.0, addedDaysAgo = 35.0, tagline = "The most dangerous machine makes no sound.",
            overview = "An engineer who designed a silent train discovers why the city's night shift keeps disappearing between " +
                "two stations.",
            cast = listOf("Arjun Mehta", "Klara Novak", "Jules Fontaine"), director = listOf("Simone Akerman"),
        ),
        Spec(
            "summer-of-kites", "Summer of Kites", year = 2018, genres = listOf("Comedy", "Family"), rating = 7.0, maturity = "0",
            runtime = 92.0, addedDaysAgo = 70.0, tagline = "Hold on tight.",
            overview = "A grandfather and his three grandchildren enter the village kite festival with a kite that may be a " +
                "little too good at flying.",
            cast = listOf("Bruno Albrecht", "Lily Hart", "Sami Rahman"), director = listOf("Elsa Moen"),
        ),
        Spec(
            "firewalk-avenue", "Firewalk Avenue", year = 2022, genres = listOf("Action", "Crime"), rating = 7.3, maturity = "16",
            runtime = 118.0, addedDaysAgo = 18.0, tagline = "One street. One night. No way out.",
            overview = "During a citywide blackout, a getaway driver has until sunrise to get a witness across a neighborhood " +
                "that wants them both gone.",
            cast = listOf("Marcus Vale", "Rina Takeda", "Gideon Shaw"), director = listOf("Lorenzo Basile"),
        ),
        Spec(
            "atlas-station", "Atlas Station", kind = TitleKind.SHOW, year = 2023, genres = listOf("Sci-Fi & Fantasy", "Drama"),
            rating = 8.7, maturity = "12", runtime = 47.0, quality = "4K", addedDaysAgo = 3.0,
            tagline = "Four hundred people. One ring. Nowhere else to go.",
            overview = "Aboard a ring station orbiting a gas giant, the crew of Atlas keep humanity's most distant outpost alive — " +
                "until the supply ships stop coming.",
            cast = listOf("Selma Idris", "Owen Hartley", "Mirela Petrov", "Theo Lundgren", "Aiko Brandt"),
            director = emptyList(), tags = listOf("Suspenseful", "Ensemble"),
        ),
        Spec(
            "kitchen-after-midnight", "Kitchen After Midnight", kind = TitleKind.SHOW, year = 2024, genres = listOf("Reality", "Comedy"),
            rating = 7.2, maturity = "0", runtime = 32.0, addedDaysAgo = 6.0, tagline = "The best food happens after closing time.",
            overview = "Chefs from the city's busiest restaurants compete to cook the perfect late-night meal with whatever is " +
                "left in the walk-in.",
            cast = listOf("Hosted by Nico Ferraro"), director = emptyList(),
        ),
        Spec(
            "wilder-files", "The Wilder Files", kind = TitleKind.SHOW, year = 2021, genres = listOf("Crime", "Mystery"), rating = 7.8,
            maturity = "16", runtime = 52.0, addedDaysAgo = 25.0, tagline = "Every town keeps a file it never closes.",
            overview = "A small-town archivist reopens the cold cases her late father couldn't let go of, one dusty box at a time.",
            cast = listOf("Evelyn Wilder", "Hugo Marsh", "Nadia Ruiz"), director = emptyList(),
        ),
        Spec(
            "moonrise-academy", "Moonrise Academy", kind = TitleKind.SHOW, year = 2022, genres = listOf("Animation", "Family"),
            rating = 7.6, maturity = "6", runtime = 24.0, addedDaysAgo = 45.0, tagline = "Class starts when the moon comes up.",
            overview = "At a boarding school that only opens at night, a shy first-year discovers she can talk to the moon.",
            cast = listOf("Voices of Lena Ortiz", "Pip Hollander"), director = emptyList(),
        ),
    )

    private fun images(id: String) = ImageSet(
        poster = "/art/posters/$id.png",
        backdrop = "/art/backdrops/$id.png",
        logo = "/art/logos/$id.png",
    )

    // region Atlas Station episodes

    private val episodeNames = mapOf(
        1 to listOf(
            "Arrival" to "A new medic arrives on Atlas just as the station's oldest reactor begins to fail.",
            "Ring Shift" to "A routine maintenance walk on the outer ring turns into a race against a spinning hull.",
            "Quiet Hours" to "Selma investigates a hydroponics bay that keeps growing plants no one planted.",
            "The Supply Window" to "The supply ship is late, and the council has to decide who goes hungry first.",
            "Gas Giant Weather" to "A storm on the planet below knocks out communications with home.",
            "Twelve Minutes of Light" to "During the station's eclipse, the crew learns how much power they really have.",
            "Old Orbits" to "Owen finds a log from Atlas's first crew that was never meant to be read.",
            "Last Ship Home" to "The final supply ship docks — empty.",
        ),
        2 to listOf(
            "Rationing" to "With no ships coming, Atlas must learn to live on what it can grow and repair.",
            "Spin Down" to "To save power, the council votes to slow the ring, and gravity becomes a luxury.",
            "Signal Garden" to "A faint signal from the planet's moons offers hope — and a terrible choice.",
            "Hull Breach" to "A micrometeor storm tests the crew's trust in their new commander.",
            "The Long Walk" to "Mirela and Theo cross the dark side of the ring to restart a forgotten generator.",
            "Atlas Rising" to "The station makes a desperate burn toward the moons.",
        ),
    )

    val seasons: List<SeasonDTO> = episodeNames.map { (s, eps) ->
        SeasonDTO(
            number = s,
            name = "Season $s",
            episodes = eps.mapIndexed { i, (name, overview) ->
                val e = i + 1
                EpisodeDTO(
                    id = "ep-atlas-s${s}e$e", fileId = "f-atlas-s${s}e$e", season = s, episode = e, name = name, overview = overview,
                    still = "/art/stills/atlas-s${s}e$e.png", runtime = listOf(47.0, 52.0, 44.0, 49.0, 51.0, 46.0, 55.0, 58.0)[i],
                    duration = listOf(47.0, 52.0, 44.0, 49.0, 51.0, 46.0, 55.0, 58.0)[i] * 60,
                )
            },
        )
    }
    private val episodes = seasons.flatMap { it.episodes }
    val resumeEpisode: EpisodeDTO = episodes.first { it.season == 2 && it.episode == 3 }
    private val resumePosition = 1_312.0

    // endregion

    val titles: List<TitleSummary> = specs.map { s ->
        val show = s.kind == TitleKind.SHOW
        val atlas = s.id == "atlas-station"
        TitleSummary(
            id = s.id, kind = s.kind, name = s.name, year = s.year, overview = s.overview, genres = s.genres, tags = s.tags,
            rating = s.rating, popularity = s.rating * 40, maturity = s.maturity, runtime = s.runtime,
            seasonCount = if (atlas) 2 else if (show) 1 else 0,
            episodeCount = if (atlas) episodes.size else if (show) 8 else 1,
            quality = s.quality, images = images(s.id), addedAt = now - s.addedDaysAgo * DAY,
            people = s.cast + s.director, libraryIds = listOf(if (show) "tv" else "movies"),
            playFileId = if (atlas) episodes.first().fileId else "f-${s.id}",
        )
    }

    private val byId = titles.associateBy { it.id }
    fun summary(id: String): TitleSummary = byId.getValue(id)

    fun detail(id: String): TitleDetail? {
        val t = byId[id] ?: return null
        val s = specs.first { it.id == id }
        val similar = titles.filter { it.id != id }
            .sortedByDescending { o -> o.genres.count { it in t.genres } * 10 + (o.rating ?: 0.0) }
            .take(9).map { it.id }
        val show = t.kind == TitleKind.SHOW
        return TitleDetail(
            id = t.id, kind = t.kind, name = t.name, year = t.year, overview = t.overview, genres = t.genres, tags = t.tags,
            rating = t.rating, maturity = t.maturity, runtime = t.runtime, seasonCount = t.seasonCount, episodeCount = t.episodeCount,
            quality = t.quality, images = t.images, playFileId = t.playFileId, tagline = s.tagline,
            cast = s.cast.map { CastMember(it) },
            directors = s.director, creators = if (show) listOf("Johanna Ek", "David Mensah") else emptyList(),
            writers = if (show) listOf("Johanna Ek", "Rui Salgado") else s.director,
            studios = listOf("Home Blockbuster Demo Pictures"),
            seasons = if (id == "atlas-station") seasons else emptyList(),
            similar = similar,
        )
    }

    // region Profiles

    fun profiles(mainId: String) = listOf(
        ProfileDTO(mainId, "Alex", "smile-blue"),
        ProfileDTO("p-sam", "Sam", "grin-orange"),
        ProfileDTO("p-mia", "Mia", "cool-purple"),
        ProfileDTO("p-jo", "Jo", "wink-green"),
        ProfileDTO("p-kids", "Kids", "kids-rainbow", kids = true),
    )

    val continueItems: List<ContinueItem> by lazy {
        val atlas = resumeEpisode
        listOf(
            ContinueItem("atlas-station", atlas.fileId, resumePosition, atlas.duration!!, resumePosition / atlas.duration!!, atlas, now - 3_600_000),
            ContinueItem("neon-harbor", "f-neon-harbor", 4_420.0, 7_020.0, 0.63, null, now - 86_400_000),
            ContinueItem("glass-orchard", "f-glass-orchard", 1_250.0, 6_720.0, 0.19, null, now - 2 * 86_400_000),
            ContinueItem("low-tide-radio", "f-low-tide-radio", 3_900.0, 6_060.0, 0.64, null, now - 3 * 86_400_000),
        )
    }

    val state: ProfileState by lazy {
        val progress = mutableMapOf<String, ProgressEntry>()
        for (ep in episodes) {
            val watched = ep.season == 1 || (ep.season == 2 && ep.episode < 3)
            if (watched) progress[ep.fileId] = ProgressEntry(ep.fileId, "atlas-station", ep.duration!!, ep.duration!!, now - 5 * 86_400_000, true)
        }
        for (c in continueItems) progress[c.fileId] = ProgressEntry(c.fileId, c.titleId, c.position, c.duration, c.updatedAt, false)
        ProfileState(
            myList = listOf("midnight-cartographer", "orbit-small-things", "copper-valley", "paper-comets", "wilder-files"),
            ratings = mapOf("atlas-station" to 2),
            progress = progress,
        )
    }

    // endregion

    fun playback(fileId: String): PlaybackInfo? {
        val ep = episodes.firstOrNull { it.fileId == fileId }
        val title = if (ep != null) summary("atlas-station") else titles.firstOrNull { it.playFileId == fileId } ?: return null
        val next = ep?.let { e -> episodes.getOrNull(episodes.indexOf(e) + 1) }
        val duration = ep?.duration ?: ((title.runtime ?: 100.0) * 60)
        return PlaybackInfo(
            fileId = fileId, titleId = title.id, title = title, episode = ep, next = next, mode = PlaybackMode.DIRECT,
            url = "/api/stream/$fileId", duration = duration,
            subtitles = listOf(SubtitleTrack("en", "English", "en", source = "embedded")),
            resumeAt = if (fileId == resumeEpisode.fileId) resumePosition else 0.0,
        )
    }
}
