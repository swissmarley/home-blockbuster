package com.swissmarley.homeblockbuster.screenshots

import android.graphics.BitmapFactory
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import androidx.compose.runtime.MutableState
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.media3.ui.PlayerView
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.annotation.DelicateCoilApi
import coil3.imageDecoderEnabled
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.allowHardware
import coil3.request.crossfade
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import com.swissmarley.homeblockbuster.HomeBlockbusterApp
import com.swissmarley.homeblockbuster.MainActivity
import com.swissmarley.homeblockbuster.data.ApiClient
import com.swissmarley.homeblockbuster.data.ServerConnection
import com.swissmarley.homeblockbuster.player.PlayerController
import com.swissmarley.homeblockbuster.state.AppModel
import com.swissmarley.homeblockbuster.state.Phase
import com.swissmarley.homeblockbuster.util.Rows
import kotlinx.coroutines.launch
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.Duration
import java.util.Calendar
import java.util.IdentityHashMap

/**
 * Renders the real app (MainActivity, real Compose UI, real networking and image loading) against
 * [DemoServer] and saves the Play Store screenshots. Run through android/play-store/make-screenshots.sh;
 * only compiled when HB_SCREENSHOT_ART is set (see app/build.gradle.kts).
 *
 * 360x640 dp at xxhdpi = exactly 1080x1920 px; the landscape player is 1920x1080.
 */
@OptIn(ExperimentalRoborazziApi::class, DelicateCoilApi::class)
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w360dp-h640dp-xxhdpi")
class PlayStoreScreenshots {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val art = File(System.getenv("HB_SCREENSHOT_ART") ?: error("HB_SCREENSHOT_ART not set"))
    private val out = File(System.getenv("HB_SCREENSHOT_OUT") ?: "build/play-store-screenshots").also { it.mkdirs() }
    private var server: DemoServer? = null
    private val app: AppModel get() = HomeBlockbusterApp.instance.model

    @After
    fun tearDown() {
        server?.close()
    }

    // region Helpers

    /** Runs the main looper and the Compose clock forward, giving network threads real time to answer. */
    private fun pump(ms: Long = 500) {
        compose.mainClock.autoAdvance = false
        var left = ms
        while (left > 0) {
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(16))
            compose.mainClock.advanceTimeBy(16)
            Thread.sleep(4)
            left -= 16
        }
    }

    private fun waitFor(what: String, timeoutMs: Long = 20_000, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (!condition()) {
            check(System.currentTimeMillis() < end) { "Timed out waiting for $what" }
            pump(50)
        }
    }

    /** Waits until no new artwork has been requested for a while, then lets crossfades finish. */
    private fun settle() {
        var last = -1
        var stableSince = System.currentTimeMillis()
        val end = System.currentTimeMillis() + 30_000
        while (System.currentTimeMillis() < end) {
            pump(100)
            val served = server?.artServed ?: 0
            if (served != last) {
                last = served
                stableSince = System.currentTimeMillis()
            } else if (System.currentTimeMillis() - stableSince > 1500) {
                break
            }
        }
        pump(800)
        println("settled: ${server?.artServed} artwork files served")
    }

    /**
     * Robolectric draws no system bars, so the window reports none. Give it the insets of a phone with a
     * 24 dp status bar and gesture navigation, so the app lays out as on a device; finish_screenshots.py
     * then draws the status bar into that space.
     */
    private fun applySystemBars() {
        val decor = compose.activity.window.decorView
        val insets = WindowInsetsCompat.Builder()
            .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, STATUS_BAR_PX, 0, 0))
            .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, 0, NAV_BAR_PX))
            .build()
        ViewCompat.dispatchApplyWindowInsets(decor, insets)
        pump(300)
    }

    private fun capture(name: String) {
        applySystemBars()
        settle()
        captureScreenRoboImage(File(out, "$name.png").path)
    }

    /** A profile id for which the home billboard (picked by a daily hash, like on every client) is [titleId]. */
    private fun profileIdShowing(titleId: String): String {
        val day = Calendar.getInstance().get(Calendar.DAY_OF_MONTH)
        return (1..10_000).asSequence().map { "p-alex-$it" }
            .first { Rows.billboard(DemoLibrary.titles, "$it-all-$day")?.id == titleId }
    }

    private fun connect(profileId: String, selectProfile: Boolean) {
        // Same loader as the app, but decoding with BitmapFactory and without hardware bitmaps:
        // Robolectric supports neither ImageDecoder nor drawing hardware bitmaps. No crossfade: it runs on the
        // real clock, not Robolectric's, and would be captured half-way.
        SingletonImageLoader.setUnsafe { context ->
            ImageLoader.Builder(context)
                .components { add(OkHttpNetworkFetcherFactory(callFactory = { ApiClient.http })) }
                .allowHardware(false)
                .crossfade(false)
                .imageDecoderEnabled(false)
                .build()
        }
        val s = DemoServer(art, profileId)
        server = s
        val home = ServerConnection(name = "Home", url = s.url, lastUsedAt = System.currentTimeMillis())
        app.saveServer(home)
        app.scope.launch { app.connect(home) }
        waitFor("profiles") { app.phase == Phase.PROFILES && app.profiles.isNotEmpty() }
        if (selectProfile) {
            app.scope.launch { app.select(app.profiles.first { it.id == profileId }) }
            waitFor("library") { app.phase == Phase.BROWSING && app.titles.isNotEmpty() && !app.libraryLoading }
        }
    }

    private fun scrollMain(byPx: Float) {
        compose.onAllNodes(hasScrollAction().and(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)))
            .onFirst()
            .performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, byPx) }
        pump(300)
    }

    private fun openBillboardInfo() {
        compose.onNodeWithText("Info").performClick()
        waitFor("title page") { compose.onAllNodesWithText("About", substring = true).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun findView(root: View, type: Class<*>): View? {
        if (type.isInstance(root)) return root
        if (root is ViewGroup) for (i in 0 until root.childCount) findView(root.getChildAt(i), type)?.let { return it }
        return null
    }

    /** Finds an object of [type] reachable from [root] through fields (the controller listening to the player). */
    private fun <T> findReachable(root: Any, type: Class<T>, depth: Int = 5, seen: MutableMap<Any, Boolean> = IdentityHashMap()): T? {
        if (type.isInstance(root)) return type.cast(root)
        if (depth == 0 || seen.put(root, true) != null) return null
        val children: List<Any?> = when (root) {
            is Collection<*> -> root.toList()
            is Map<*, *> -> root.values.toList()
            is Array<*> -> root.toList()
            else -> generateSequence<Class<*>>(root.javaClass) { it.superclass }
                .takeWhile { it != Any::class.java }
                .flatMap { it.declaredFields.asSequence() }
                .filter { !it.type.isPrimitive && !java.lang.reflect.Modifier.isStatic(it.modifiers) }
                .mapNotNull { f -> runCatching { f.isAccessible = true; f.get(root) }.getOrNull() }
                .toList()
        }
        for (c in children) {
            if (c == null || c is String || c is Number || c is Thread) continue
            findReachable(c, type, depth - 1, seen)?.let { return it }
        }
        return null
    }

    @Suppress("UNCHECKED_CAST")
    private fun setState(obj: Any, name: String, value: Any?) {
        val f = obj.javaClass.getDeclaredField("$name\$delegate")
        f.isAccessible = true
        (f.get(obj) as MutableState<Any?>).value = value
    }

    // endregion

    @Test
    fun browse() {
        connect(profileIdShowing("last-lighthouse"), selectProfile = true)
        capture("01-browse")
        scrollMain(SCROLL_ROWS_PX)
        capture("02-rows")
    }

    @Test
    fun movieDetail() {
        connect(profileIdShowing("neon-harbor"), selectProfile = true)
        openBillboardInfo()
        settle()
        scrollMain(SCROLL_DETAIL_PX)
        capture("03-detail")
    }

    @Test
    fun seriesDetail() {
        connect(profileIdShowing("atlas-station"), selectProfile = true)
        openBillboardInfo()
        settle()
        scrollMain(SCROLL_SERIES_PX)
        capture("04-series")
    }

    @Test
    @Config(qualifiers = "w640dp-h360dp-land-xxhdpi")
    fun player() {
        connect(profileIdShowing("atlas-station"), selectProfile = true)
        val ep = DemoLibrary.resumeEpisode
        app.play(ep.fileId, "atlas-station")
        val activity = compose.activity
        waitFor("player") { findView(activity.window.decorView, PlayerView::class.java) != null }
        val view = findView(activity.window.decorView, PlayerView::class.java) as PlayerView
        val controller = findReachable(view.player!!, PlayerController::class.java) ?: error("PlayerController not found")
        waitFor("playback info") { controller.info != null }
        pump(300)
        // Robolectric can't decode video: stop the player and show a still frame where the video would be,
        // with the controller in the state it has a moment after the user taps a playing video.
        controller.player.stop()
        pump(100)
        view.overlayFrameLayout!!.addView(
            ImageView(activity).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                setImageBitmap(BitmapFactory.decodeFile(File(art, "frame.png").path))
            },
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
        )
        setState(controller, "loading", false)
        setState(controller, "buffering", false)
        setState(controller, "isPlaying", true)
        setState(controller, "position", DemoLibrary.playback(ep.fileId)!!.resumeAt)
        setState(controller, "cueText", "If the ships aren't coming, then we go to them.")
        pump(300)
        captureScreenRoboImage(File(out, "06-player.png").path)
    }

    @Test
    fun profiles() {
        connect("p-alex", selectProfile = false)
        capture("07-profiles")
    }

    @Test
    fun addServer() {
        pump(500)
        compose.onAllNodesWithText("Add Server").onFirst().performClick()
        pump(1000)
        compose.onNodeWithText("Address").performTextInput("192.168.1.20:8585")
        compose.onNodeWithText("Name").performTextInput("Living Room")
        pump(1000)
        capture("05-add-server")
    }

    private companion object {
        const val STATUS_BAR_PX = 72 // 24 dp
        const val NAV_BAR_PX = 48 // 16 dp gesture bar
        const val SCROLL_ROWS_PX = 1320f
        const val SCROLL_DETAIL_PX = 300f
        const val SCROLL_SERIES_PX = 2190f
    }
}
