package com.swissmarley.homeblockbuster

import com.swissmarley.homeblockbuster.data.ContinueItem
import com.swissmarley.homeblockbuster.data.HbJson
import com.swissmarley.homeblockbuster.data.ImageSet
import com.swissmarley.homeblockbuster.data.ProfileState
import com.swissmarley.homeblockbuster.data.ServerConnection
import com.swissmarley.homeblockbuster.data.TitleKind
import com.swissmarley.homeblockbuster.data.TitleSummary
import com.swissmarley.homeblockbuster.util.BrowseFilter
import com.swissmarley.homeblockbuster.util.Format
import com.swissmarley.homeblockbuster.util.RowDef
import com.swissmarley.homeblockbuster.util.Rows
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LogicTest {
    @Test
    fun normalizesServerAddresses() {
        assertEquals("http://192.168.1.20:8585", ServerConnection.normalize("192.168.1.20"))
        assertEquals("http://nas.local:8585", ServerConnection.normalize("  nas.local  "))
        assertEquals("http://nas.local:9000", ServerConnection.normalize("nas.local:9000"))
        assertEquals("http://nas.local", ServerConnection.normalize("http://nas.local/"))
        assertEquals("https://media.example.com/hb", ServerConnection.normalize("HTTPS://media.example.com/hb/api/titles?x=1"))
        assertEquals("https://box.tail1234.ts.net", ServerConnection.normalize("https://box.tail1234.ts.net"))
        assertNull(ServerConnection.normalize(""))
        assertNull(ServerConnection.normalize("http://"))
    }

    @Test
    fun displayHostKeepsPort() {
        assertEquals("nas.local:8585", ServerConnection(name = "x", url = "http://nas.local:8585").displayHost)
        assertEquals("media.example.com", ServerConnection(name = "x", url = "https://media.example.com").displayHost)
    }

    @Test
    fun formats() {
        assertEquals("1h 30m", Format.runtime(90.0))
        assertEquals("45m", Format.runtime(45.0))
        assertEquals("2h", Format.runtime(120.0))
        assertEquals("1:02:03", Format.clock(3723.0))
        assertEquals("4:05", Format.clock(245.0))
        assertEquals("3 Seasons", Format.length(TitleKind.SHOW, null, 3, 20))
        assertEquals(98, Format.matchPercent(10.0))
        assertNull(Format.matchPercent(null))
        assertEquals("10 of 45m", Format.progressLabel(600.0, 2700.0))
    }

    private fun title(id: String, kind: TitleKind = TitleKind.MOVIE, genres: List<String> = listOf("Drama"), rating: Double? = 7.0, name: String = id) =
        TitleSummary(id = id, kind = kind, name = name, genres = genres, rating = rating, popularity = 10.0, addedAt = 1.0, images = ImageSet(poster = "/p/$id"))

    @Test
    fun buildsRowsLikeTheOtherClients() {
        val titles = (1..12).map { title("m$it") } + (1..12).map { title("s$it", TitleKind.SHOW, listOf("Comedy")) }
        val map = titles.associateBy { it.id }
        val cont = listOf(ContinueItem(titleId = "m1", fileId = "f1", position = 10.0, duration = 100.0, progress = 0.1))
        val rows = Rows.build(titles, map, ProfileState(myList = listOf("s2")), cont, "Alex", BrowseFilter.ALL)
        assertEquals("continue", rows.first().id)
        assertEquals("Continue Watching for Alex", rows.first().title)
        assertTrue(rows.any { it.id == "mylist" })
        assertTrue(rows.any { it.id == "top-movies" && it.style == RowDef.Style.TOP10 && it.items.size == 10 })
        assertTrue(rows.any { it.id == "top-shows" })
        assertTrue(rows.any { it.id == "because" })
        // Rows with identical contents are dropped.
        val sigs = rows.filter { it.style != RowDef.Style.CONTINUE }.map { r -> r.items.map { it.id }.sorted() }
        assertEquals(sigs.size, sigs.toSet().size)

        val showsOnly = Rows.build(titles, map, null, cont, "Alex", BrowseFilter.SHOW)
        assertTrue(showsOnly.none { it.id == "continue" })
        assertTrue(showsOnly.all { r -> r.items.all { it.kind == TitleKind.SHOW } })
    }

    @Test
    fun searchesNamesPeopleAndGenres() {
        val titles = listOf(
            title("a", name = "Big Buck Bunny", genres = listOf("Animation")),
            title("b", name = "Sintel", genres = listOf("Fantasy")).copy(people = listOf("Halina Reijn")),
            title("c", name = "Café Society", genres = listOf("Comedy")),
        )
        assertEquals("a", Rows.search(titles, "bunny").first().id)
        assertEquals("b", Rows.search(titles, "reijn").first().id)
        assertEquals("c", Rows.search(titles, "cafe").first().id)
        assertEquals("a", Rows.search(titles, "anim").first().id)
        assertTrue(Rows.search(titles, "zzz").isEmpty())
    }

    @Test
    fun billboardIsStableForASeed() {
        val titles = (1..20).map { title("t$it") }
        assertEquals(Rows.billboard(titles, "seed")?.id, Rows.billboard(titles, "seed")?.id)
    }

    @Test
    fun decodesTolerantly() {
        val t = HbJson.decodeFromString(TitleSummary.serializer(), """{"id":"x","kind":"show","name":"N","rating":null,"unknown":1,"images":{}}""")
        assertEquals(TitleKind.SHOW, t.kind)
        assertTrue(t.isAvailable)
    }
}
