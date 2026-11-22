package com.swissmarley.homeblockbuster.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight

object Avatars {
    val all = listOf(
        "smile-blue", "smile-yellow", "smile-red", "smile-green", "smile-purple", "smile-teal",
        "grin-orange", "grin-pink", "grin-blue", "wink-red", "wink-green", "cool-slate", "cool-purple",
        "wow-yellow", "wow-teal", "kids-rainbow",
    )

    val colors = mapOf(
        "blue" to Color(0xFF2F6FE4), "yellow" to Color(0xFFF2B705), "red" to Color(0xFFE2262F),
        "green" to Color(0xFF23A55A), "purple" to Color(0xFF7A4BE0), "teal" to Color(0xFF12A6A8),
        "orange" to Color(0xFFF07318), "pink" to Color(0xFFE3408E), "slate" to Color(0xFF56657D),
    )

    val shine by lazy { svgPath("M0 0h100v46C70 36 30 60 0 50z") }
    val smile by lazy { svgPath("M26 60 Q50 84 74 60") }
    val winkEye by lazy { svgPath("M27 43 Q33.5 35 40 43") }
    val shades by lazy { svgPath("M20 36h60v4c0 7-5 12-12 12h-4c-6 0-10-4-11-9h-6c-1 5-5 9-11 9h-4c-7 0-12-5-12-12z") }
    val coolSmile by lazy { svgPath("M31 66 Q50 78 69 66") }
}

/** The same avatars as the web app ("smile-blue", "cool-slate", "kids-rainbow"…), drawn natively. */
@Composable
fun Avatar(id: String, modifier: Modifier = Modifier, cornerRadius: Float = 6f) {
    BoxWithConstraints(modifier.aspectRatio(1f)) {
        val side = minOf(maxWidth, maxHeight)
        val shape = RoundedCornerShape(side * (cornerRadius / 100f))
        if (id == "kids-rainbow") {
            Box(
                Modifier
                    .fillMaxSize()
                    .clip(shape)
                    .background(
                        Brush.linearGradient(listOf(Color(0xFFFF5F6D), Color(0xFFFFC371), Color(0xFF47CF73), Color(0xFF3A8DDE)))
                    ),
                contentAlignment = Alignment.Center,
            ) {
                val px = with(LocalDensity.current) { (side * 0.34f).toSp() }
                Text("kids", color = Color.White, fontWeight = FontWeight.Black, fontSize = px)
            }
        } else {
            val parts = id.split("-")
            val face = parts.firstOrNull()?.takeIf { it in setOf("smile", "grin", "wink", "cool", "wow") } ?: "smile"
            val color = Avatars.colors[parts.lastOrNull()] ?: Avatars.colors.getValue("blue")
            Canvas(Modifier.fillMaxSize().clip(shape).background(color)) {
                scale(size.width / 100f, size.height / 100f, pivot = Offset.Zero) {
                    drawPath(Avatars.shine, Color.White.copy(alpha = 0.07f))
                    drawFace(face)
                }
            }
        }
    }
}

private fun DrawScope.drawFace(face: String) {
    val white = Color.White
    fun eye(x: Float) = drawRoundRect(white, Offset(x, 33f), Size(9f, 17f), CornerRadius(4.5f, 4.5f))
    val round = Stroke(width = 8f, cap = StrokeCap.Round)
    when (face) {
        "grin" -> {
            drawCircle(white, 6f, Offset(34f, 40f))
            drawCircle(white, 6f, Offset(66f, 40f))
            val mouth = Path().apply {
                moveTo(26f, 57f)
                lineTo(74f, 57f)
                arcTo(Rect(Offset(50f, 57f), 24f), 0f, 180f, false)
                close()
            }
            drawPath(mouth, white)
        }
        "wink" -> {
            drawPath(Avatars.winkEye, white, style = Stroke(width = 6f, cap = StrokeCap.Round))
            eye(62f)
            drawPath(Avatars.smile, white, style = round)
        }
        "cool" -> {
            drawPath(Avatars.shades, Color(0xFF111111))
            drawPath(Avatars.coolSmile, white, style = Stroke(width = 7f, cap = StrokeCap.Round))
        }
        "wow" -> {
            for (x in listOf(34f, 66f)) {
                drawCircle(white, 7f, Offset(x, 40f))
                drawCircle(Color.Black.copy(alpha = 0.55f), 3f, Offset(x, 41f))
            }
            drawOval(white, Offset(41f, 57f), Size(18f, 22f))
        }
        else -> {
            eye(29f)
            eye(62f)
            drawPath(Avatars.smile, white, style = round)
        }
    }
}
