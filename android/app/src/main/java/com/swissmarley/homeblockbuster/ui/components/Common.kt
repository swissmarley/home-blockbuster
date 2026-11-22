package com.swissmarley.homeblockbuster.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.Canvas
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.swissmarley.homeblockbuster.HomeBlockbusterApp
import com.swissmarley.homeblockbuster.ui.theme.Hb

/** Parses SVG path data once (the logo and avatars are drawn from the web app's SVGs). */
fun svgPath(data: String): Path = PathParser().parsePathString(data).toPath()

private const val LOGO_DATA =
    "M17 8h17c8.2 0 12.6 4.4 12.6 11 0 4.4-2 7.7-5.6 9.5 4.8 1.7 7.7 5.6 7.7 11 0 8.4-5.2 16.5-15 16.5H17V8zm11 8.6v11h4.4c3.1 0 4.7-2 4.7-5.5s-1.6-5.5-4.7-5.5H28zm0 19v12h5.4c3.4 0 5.1-2.2 5.1-6s-1.7-6-5.1-6H28z"
private val logoPath by lazy { svgPath(LOGO_DATA) }

/** The red "B" mark from the web app, drawn in a 64×64 box. */
@Composable
fun LogoMark(modifier: Modifier = Modifier, color: Color = Hb.red) {
    Canvas(modifier) {
        val scale = minOf(size.width, size.height) / 64f
        withTransform({
            translate(size.width / 2 - 32 * scale, size.height / 2 - 32 * scale)
            scale(scale, scale, pivot = Offset.Zero)
        }) {
            drawPath(logoPath, color)
        }
    }
}

@Composable
fun Wordmark(size: Int = 28) {
    Text(
        "HOME BLOCKBUSTER",
        color = Hb.red,
        fontSize = size.sp,
        fontWeight = FontWeight.Black,
        letterSpacing = (-0.5).sp,
        maxLines = 1,
    )
}

/** Artwork from the connected server. `path` is server-relative ("/api/img?…"). */
@Composable
fun RemoteImage(
    path: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    placeholder: Color = Hb.surface,
) {
    val client = HomeBlockbusterApp.instance.model.client
    Box(modifier.background(placeholder)) {
        if (path != null && client != null) {
            AsyncImage(
                model = client.url(path),
                contentDescription = null,
                contentScale = contentScale,
                modifier = Modifier.matchParentSize(),
            )
        }
    }
}

/** Primary white "Play" button. */
@Composable
fun PrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    fill: Color = Color.White,
    foreground: Color = Color.Black,
    enabled: Boolean = true,
    busy: Boolean = false,
    onClick: () -> Unit,
) {
    Row(
        modifier
            .heightIn(min = 44.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (enabled) fill else fill.copy(alpha = 0.4f))
            .clickable(enabled = enabled && !busy, onClick = onClick)
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), color = foreground, strokeWidth = 2.dp)
        } else {
            if (icon != null) {
                Icon(icon, null, tint = foreground, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(6.dp))
            }
            Text(text, color = foreground, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 1)
        }
    }
}

/** Dark grey secondary button. */
@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true, onClick: () -> Unit) {
    PrimaryButton(text, modifier, icon, fill = Color.White.copy(alpha = 0.2f), foreground = Color.White, enabled = enabled, onClick = onClick)
}

/** Icon-over-label action ("My List", "Rate"). */
@Composable
fun IconAction(icon: ImageVector, title: String, onClick: () -> Unit) {
    Column(
        Modifier
            .widthIn(min = 64.dp)
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, title, tint = Color.White, modifier = Modifier.size(26.dp))
        Spacer(Modifier.height(6.dp))
        Text(title, color = Hb.secondaryText, fontSize = 12.sp)
    }
}

@Composable
fun ProgressBar(fraction: Float, modifier: Modifier = Modifier, track: Color = Color.White.copy(alpha = 0.25f)) {
    Box(modifier.height(3.dp).background(track)) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(3.dp).background(Hb.red))
    }
}

/** Pill chip used for meta info like "PG-13" or "4K". */
@Composable
fun Badge(text: String, outlined: Boolean = true) {
    Text(
        text,
        fontSize = 11.sp,
        fontWeight = FontWeight.SemiBold,
        color = Hb.secondaryText,
        modifier = Modifier
            .then(
                if (outlined) Modifier.border(1.dp, Hb.secondaryText, RoundedCornerShape(2.dp))
                else Modifier.background(Color.White.copy(alpha = 0.2f), RoundedCornerShape(2.dp))
            )
            .padding(horizontal = 4.dp, vertical = 1.dp),
    )
}

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String? = null,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, null, tint = Hb.secondaryText, modifier = Modifier.size(44.dp))
        Text(title, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White, textAlign = TextAlign.Center)
        if (message != null) {
            Text(message, fontSize = 14.sp, color = Hb.secondaryText, textAlign = TextAlign.Center)
        }
        if (actionLabel != null && onAction != null) {
            TextButton(onClick = onAction) { Text(actionLabel, color = Color.White) }
        }
    }
}

@Composable
fun Loading(modifier: Modifier = Modifier) {
    Box(modifier, contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Color.White)
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        color = Hb.secondaryText,
        modifier = modifier.padding(start = 16.dp, end = 16.dp, top = 22.dp, bottom = 6.dp),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

