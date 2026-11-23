package com.swissmarley.homeblockbuster.ui.theme

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color

object Hb {
    val red = Color(0xFFE50914)
    val background = Color(0xFF141414)
    val surface = Color(0xFF292929)
    val surfaceHigh = Color(0xFF383838)
    val secondaryText = Color(0xFFB3B3B3)
    val tertiaryText = Color(0xFF808080)
    val match = Color(0xFF46D466)
}

private val colors = darkColorScheme(
    primary = Hb.red,
    onPrimary = Color.White,
    secondary = Color.White,
    onSecondary = Color.Black,
    background = Hb.background,
    onBackground = Color.White,
    surface = Hb.background,
    onSurface = Color.White,
    surfaceVariant = Hb.surface,
    onSurfaceVariant = Hb.secondaryText,
    surfaceContainer = Hb.surface,
    surfaceContainerHigh = Hb.surfaceHigh,
    surfaceContainerHighest = Hb.surfaceHigh,
    surfaceContainerLow = Hb.surface,
    outline = Hb.tertiaryText,
    error = Hb.red,
)

@Composable
fun HomeBlockbusterTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors) {
        // Text and icons default to LocalContentColor, which is black unless a Surface or Scaffold sets it:
        // screens drawn straight on the dark background (profiles, player) need white.
        CompositionLocalProvider(LocalContentColor provides Color.White, content = content)
    }
}
