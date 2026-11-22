package com.swissmarley.homeblockbuster

import android.app.PictureInPictureParams
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.swissmarley.homeblockbuster.ui.Root
import com.swissmarley.homeblockbuster.ui.theme.HomeBlockbusterTheme

class MainActivity : ComponentActivity() {
    /** True while the full-screen player is up; drives orientation, system bars and picture-in-picture. */
    private var playerActive = false
    var inPictureInPicture by mutableStateOf(false)
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(0), navigationBarStyle = SystemBarStyle.dark(0))
        super.onCreate(savedInstanceState)
        val model = (application as HomeBlockbusterApp).model
        setContent {
            HomeBlockbusterTheme {
                Root(model, this)
            }
        }
        model.restore()
    }

    /** The player unlocks landscape and hides the system bars; everything else stays portrait on phones. */
    fun setPlayerActive(active: Boolean) {
        if (playerActive == active) return
        playerActive = active
        val isTablet = resources.configuration.smallestScreenWidthDp >= 600
        requestedOrientation = when {
            active -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            isTablet -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            else -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        }
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (active) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            setPictureInPictureParams(pipParams(active))
        }
    }

    private fun pipParams(autoEnter: Boolean): PictureInPictureParams =
        PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).apply {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setAutoEnterEnabled(autoEnter)
                setSeamlessResizeEnabled(true)
            }
        }.build()

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Before Android 12 there's no auto-enter: going home while a video plays keeps it in a small window.
        if (playerActive && Build.VERSION.SDK_INT < Build.VERSION_CODES.S &&
            packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)
        ) {
            runCatching { enterPictureInPictureMode(pipParams(false)) }
        }
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPictureInPicture = isInPictureInPictureMode
    }

    override fun onStart() {
        super.onStart()
        requestedOrientation = if (playerActive) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        else if (resources.configuration.smallestScreenWidthDp >= 600) ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }
}
