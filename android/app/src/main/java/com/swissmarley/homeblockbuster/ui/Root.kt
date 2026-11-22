package com.swissmarley.homeblockbuster.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.swissmarley.homeblockbuster.MainActivity
import com.swissmarley.homeblockbuster.player.PlayerScreen
import com.swissmarley.homeblockbuster.state.AppModel
import com.swissmarley.homeblockbuster.state.Phase
import com.swissmarley.homeblockbuster.ui.browse.MainTabs
import com.swissmarley.homeblockbuster.ui.components.LogoMark
import com.swissmarley.homeblockbuster.ui.profiles.ProfilePicker
import com.swissmarley.homeblockbuster.ui.servers.LoginScreen
import com.swissmarley.homeblockbuster.ui.servers.ServerList
import com.swissmarley.homeblockbuster.ui.theme.Hb

@Composable
fun Root(app: AppModel, activity: MainActivity) {
    val request = app.playRequest
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    // Previews pause while the full player is up or the app is in the background.
    DisposableEffect(lifecycle, request) {
        val observer = LifecycleEventObserver { _, _ ->
            app.previews.suspended = !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) || app.playRequest != null
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    Box(Modifier.fillMaxSize().background(Hb.background)) {
        AnimatedContent(
            targetState = app.phase,
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "phase",
        ) { phase ->
            when (phase) {
                Phase.SERVERS -> ServerList(app)
                Phase.CONNECTING -> Connecting(app)
                Phase.LOGIN -> LoginScreen(app)
                Phase.PROFILES -> ProfilePicker(app)
                Phase.BROWSING -> MainTabs(app)
            }
        }

        if (request != null) {
            // Keyed by request so a new "Play" always starts a fresh session.
            androidx.compose.runtime.key(request.id) {
                PlayerScreen(app, activity, request, onClose = { app.playerClosed() })
            }
        }

        AnimatedVisibility(
            visible = app.toast != null && !activity.inPictureInPicture,
            enter = slideInVertically { it } + fadeIn(),
            exit = slideOutVertically { it } + fadeOut(),
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 90.dp, start = 16.dp, end = 16.dp),
        ) {
            Text(
                app.toast ?: "",
                color = Color.White,
                fontSize = 14.sp,
                modifier = Modifier
                    .background(Color(0xEE333333), RoundedCornerShape(50))
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            )
        }
    }

    LaunchedEffect(request == null) {
        activity.setPlayerActive(request != null)
    }
}

@Composable
private fun Connecting(app: AppModel) {
    Column(
        Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically),
    ) {
        LogoMark(Modifier.size(72.dp))
        CircularProgressIndicator(color = Color.White)
        app.current?.let { Text("Connecting to ${it.name}…", color = Hb.secondaryText) }
        TextButton(onClick = { app.disconnect(keepError = false) }) { Text("Cancel", color = Hb.secondaryText) }
    }
}
