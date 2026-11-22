package com.swissmarley.homeblockbuster

import com.swissmarley.homeblockbuster.data.ApiClient
import com.swissmarley.homeblockbuster.data.ApiException
import com.swissmarley.homeblockbuster.data.PlaybackMode
import com.swissmarley.homeblockbuster.data.TitleKind
import kotlinx.coroutines.runBlocking
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Drives ApiClient against a real Home Blockbuster server. Skipped unless HB_TEST_SERVER is set, e.g.
 *   HB_TEST_SERVER=http://localhost:8585 ./gradlew :app:testDebugUnitTest
 */
class ServerIntegrationTest {
    private val base: String? = System.getenv("HB_TEST_SERVER")

    @Test
    fun walksTheWholeApi() = runBlocking {
        assumeTrue("HB_TEST_SERVER not set", base != null)
        val c = ApiClient(base!!, "test", null)

        assertTrue(c.health().ok)
        val auth = c.authStatus()
        assertTrue(!auth.required || auth.authenticated)

        val created = c.createProfile("Android Test", "wink-green", false)
        try {
            val profiles = c.profiles()
            assertTrue(profiles.any { it.id == created.id })

            val updated = c.updateProfile(
                created.id,
                ApiClient.ProfileUpdate("Android Test", "cool-slate", false, autoplayNext = false, autoplayPreviews = true, subtitleLang = "en"),
            )
            assertEquals("cool-slate", updated.avatar)
            assertEquals("en", updated.subtitleLang)
            val cleared = c.updateProfile(
                created.id,
                ApiClient.ProfileUpdate("Android Test", "cool-slate", false, autoplayNext = false, autoplayPreviews = true, subtitleLang = null),
            )
            assertEquals(null, cleared.subtitleLang)

            val titles = c.titles(created.id)
            assertTrue("library is empty", titles.isNotEmpty())
            println("titles: ${titles.size} (${titles.count { it.kind == TitleKind.SHOW }} shows)")

            // Every title page decodes.
            for (t in titles) {
                val d = c.title(t.id, created.id)
                assertEquals(t.id, d.id)
            }

            val show = titles.first { it.kind == TitleKind.SHOW && it.playFileId != null }
            val detail = c.title(show.id, created.id)
            assertTrue(detail.seasons.isNotEmpty())
            val ep = detail.seasons.first().episodes.first()

            // Every playable file gets a playback decision, and its stream answers with the session headers.
            for (t in titles.filter { it.playFileId != null }) {
                val info = c.playback(t.playFileId!!, created.id)
                val path = if (info.mode == PlaybackMode.DIRECT) info.url
                else info.hlsUrl!!.replace("{session}", "androidtest") + "&start=0.000&maxh=720"
                val req = Request.Builder().url(c.url(path)).apply { c.authHeaders.forEach { (k, v) -> header(k, v) } }
                    .header("Range", "bytes=0-1023").build()
                ApiClient.http.newCall(req).execute().use { res ->
                    assertTrue("${t.name}: ${info.mode} stream answered ${res.code}", res.isSuccessful)
                }
                println("${t.name}: ${info.mode}${info.reason?.let { " ($it)" } ?: ""}, subs=${info.subtitles.size}, audio=${info.audioTracks.size}")
                for (sub in info.subtitles) {
                    val cues = c.subtitles(info.fileId, sub.id)
                    assertTrue("${t.name}: ${sub.label} has no cues", cues.isNotEmpty())
                }
            }
            val forced = c.playback(ep.fileId, created.id, force = true)
            assertTrue(forced.mode != PlaybackMode.DIRECT)
            assertNotNull(forced.hlsUrl)
            val kf = c.keyframe(ep.fileId, 5.0)
            assertTrue(kf in 0.0..5.0)

            val entry = c.progress(created.id, ep.fileId, 120.0, 3600.0)
            assertEquals(ep.fileId, entry.fileId)
            val cont = c.continueWatching(created.id)
            assertTrue(cont.any { it.fileId == ep.fileId })

            assertTrue(show.id in c.addToList(created.id, show.id).myList)
            assertEquals(2, c.rate(created.id, show.id, 2).ratings[show.id])
            assertTrue(show.id !in c.removeFromList(created.id, show.id).myList)
            c.hideContinue(created.id, show.id)
            val state = c.profileState(created.id)
            assertTrue(show.id in state.hiddenFromContinue || cont.none { it.titleId == show.id && it.fileId == ep.fileId })

            try {
                c.title("does-not-exist", created.id)
                fail("expected 404")
            } catch (e: ApiException) {
                assertEquals(404, e.status)
                println("404 message: ${e.message}")
            }
        } finally {
            c.deleteProfile(created.id)
        }
        assertTrue(c.profiles().none { it.id == created.id })

        try {
            ApiClient("http://127.0.0.1:1", "x", null).health()
            fail("expected unreachable")
        } catch (e: ApiException) {
            assertEquals(ApiException.UNREACHABLE.message, e.message)
        }
    }
}

/** Password-protected server: HB_TEST_SERVER plus HB_TEST_PASSWORD. */
class AuthIntegrationTest {
    @Test
    fun signsInWithTheSessionCookie() = runBlocking {
        val base = System.getenv("HB_TEST_SERVER")
        val password = System.getenv("HB_TEST_PASSWORD")
        assumeTrue("HB_TEST_PASSWORD not set", base != null && password != null)
        val c = ApiClient(base!!, "auth", null)
        var unauthorized = 0
        c.onUnauthorized = { unauthorized++ }

        val before = c.authStatus()
        assertTrue(before.required && !before.authenticated)
        try {
            c.profiles()
            fail("expected 401")
        } catch (e: ApiException) {
            assertEquals(401, e.status)
        }
        assertEquals(1, unauthorized)

        try {
            c.login("wrong-password")
            fail("expected a refused login")
        } catch (e: ApiException) {
            println("wrong password: ${e.status} ${e.message}")
        }
        assertEquals(null, c.token)

        c.login(password!!)
        assertNotNull(c.token)
        assertTrue(c.authStatus().authenticated)
        assertTrue(c.profiles().isNotEmpty())

        c.logout()
        assertEquals(null, c.token)
        assertTrue(!c.authStatus().authenticated)
    }
}
