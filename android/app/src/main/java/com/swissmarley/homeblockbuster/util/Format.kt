package com.swissmarley.homeblockbuster.util

import com.swissmarley.homeblockbuster.data.TitleKind
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

object Format {
    fun runtime(minutes: Double?): String? {
        if (minutes == null || minutes <= 0) return null
        val h = minutes.toInt() / 60
        val m = minutes.roundToInt() % 60
        if (h == 0) return "${m}m"
        return if (m > 0) "${h}h ${m}m" else "${h}h"
    }

    fun length(kind: TitleKind, runtime: Double?, seasonCount: Int, episodeCount: Int): String? {
        if (kind == TitleKind.MOVIE && episodeCount < 2) return runtime(runtime)
        if (seasonCount > 1) return "$seasonCount Seasons"
        if (episodeCount > 1) return "$episodeCount Episodes"
        if (episodeCount == 1) return "1 Episode"
        return null
    }

    fun clock(seconds: Double): String {
        val total = if (seconds.isFinite() && seconds > 0) seconds.toInt() else 0
        val h = total / 3600
        val m = (total / 60) % 60
        val s = total % 60
        return if (h > 0) String.format(Locale.US, "%d:%02d:%02d", h, m, s) else String.format(Locale.US, "%d:%02d", m, s)
    }

    fun progressLabel(position: Double, duration: Double): String? {
        if (duration <= 0) return null
        val total = max(1, (duration / 60).roundToInt())
        if (total >= 60) {
            val left = max(1.0, (duration - position) / 60)
            return "${runtime(left) ?: ""} left"
        }
        return "${(position / 60).roundToInt()} of ${total}m"
    }

    /** Netflix-style "97% Match" from the community rating. */
    fun matchPercent(rating: Double?): Int? {
        if (rating == null || rating <= 0) return null
        return max(35, min(99, (52 + rating * 4.6).roundToInt()))
    }

    fun isRecentlyAdded(addedAt: Double, days: Double): Boolean =
        System.currentTimeMillis() - addedAt < days * 86_400_000

    fun relative(timeMs: Long): String {
        val diff = System.currentTimeMillis() - timeMs
        val minutes = diff / 60_000
        return when {
            minutes < 1 -> "just now"
            minutes < 60 -> "$minutes min ago"
            minutes < 60 * 24 -> "${minutes / 60} h ago"
            minutes < 60 * 48 -> "yesterday"
            else -> "${minutes / (60 * 24)} days ago"
        }
    }

    val languages: List<Pair<String, String>> = listOf(
        "en" to "English", "de" to "German", "fr" to "French", "it" to "Italian", "es" to "Spanish",
        "pt" to "Portuguese", "nl" to "Dutch", "sv" to "Swedish", "da" to "Danish", "no" to "Norwegian",
        "fi" to "Finnish", "pl" to "Polish", "cs" to "Czech", "hu" to "Hungarian", "ro" to "Romanian",
        "el" to "Greek", "tr" to "Turkish", "ru" to "Russian", "uk" to "Ukrainian", "ar" to "Arabic",
        "he" to "Hebrew", "hi" to "Hindi", "ja" to "Japanese", "ko" to "Korean", "zh" to "Chinese",
        "th" to "Thai", "vi" to "Vietnamese", "id" to "Indonesian",
    )
}
