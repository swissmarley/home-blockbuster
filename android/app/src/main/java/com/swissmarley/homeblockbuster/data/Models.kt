package com.swissmarley.homeblockbuster.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Mirrors server/src/shared/types.ts. Nullable where the server may send null or older servers omit a field.

@Serializable
enum class TitleKind {
    @SerialName("movie") MOVIE,
    @SerialName("show") SHOW;

    val raw: String get() = if (this == MOVIE) "movie" else "show"
}

@Serializable
data class ImageSet(
    val poster: String? = null,
    val backdrop: String? = null,
    val card: String? = null,
    val cardHasTitle: Boolean? = null,
    val logo: String? = null,
    val thumb: String? = null,
) {
    /** 16:9 art for wide cards. */
    val wide: String? get() = card ?: backdrop ?: thumb
    /** Big hero art. */
    val hero: String? get() = backdrop ?: card ?: thumb ?: poster
}

@Serializable
data class TitleSummary(
    val id: String,
    val kind: TitleKind = TitleKind.MOVIE,
    val name: String = "",
    val year: Int? = null,
    val overview: String = "",
    val genres: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val rating: Double? = null,
    val popularity: Double? = null,
    val maturity: String? = null,
    val runtime: Double? = null,
    val seasonCount: Int = 0,
    val episodeCount: Int = 0,
    val quality: String? = null,
    val images: ImageSet = ImageSet(),
    val addedAt: Double = 0.0,
    val releaseDate: String? = null,
    val people: List<String> = emptyList(),
    val libraryIds: List<String> = emptyList(),
    val playFileId: String? = null,
    val previewUrl: String? = null,
    val source: String? = null,
    val available: Boolean? = null,
) {
    val isAvailable: Boolean get() = available ?: true
}

@Serializable
data class CastMember(val name: String, val character: String? = null, val photo: String? = null)

@Serializable
data class EpisodeDTO(
    val id: String,
    val fileId: String,
    val season: Int = 0,
    val episode: Int = 0,
    val episodeEnd: Int? = null,
    val name: String = "",
    val overview: String = "",
    val still: String? = null,
    val runtime: Double? = null,
    val airDate: String? = null,
    val duration: Double? = null,
) {
    val code: String get() = if (season == 0) "Special $episode" else "S$season:E$episode"
}

@Serializable
data class SeasonDTO(
    val number: Int,
    val name: String = "",
    val overview: String = "",
    val poster: String? = null,
    val episodes: List<EpisodeDTO> = emptyList(),
)

@Serializable
data class SubtitleTrack(
    val id: String,
    val label: String = "",
    val language: String? = null,
    val forced: Boolean = false,
    val source: String = "",
)

@Serializable
data class AudioTrack(
    val index: Int,
    val label: String = "",
    val language: String? = null,
    val codec: String = "",
    val channels: Int? = null,
    val default: Boolean = false,
)

@Serializable
data class FileDTO(
    val id: String,
    val path: String = "",
    val size: Double = 0.0,
    val container: String = "",
    val duration: Double? = null,
    val width: Int? = null,
    val height: Int? = null,
    val videoCodec: String? = null,
    val audioCodecs: List<String> = emptyList(),
    val subtitles: List<SubtitleTrack> = emptyList(),
    val libraryId: String = "",
)

@Serializable
data class TitleDetail(
    val id: String,
    val kind: TitleKind = TitleKind.MOVIE,
    val name: String = "",
    val year: Int? = null,
    val overview: String = "",
    val genres: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val rating: Double? = null,
    val maturity: String? = null,
    val runtime: Double? = null,
    val seasonCount: Int = 0,
    val episodeCount: Int = 0,
    val quality: String? = null,
    val images: ImageSet = ImageSet(),
    val playFileId: String? = null,
    val available: Boolean? = null,
    val tagline: String? = null,
    val cast: List<CastMember> = emptyList(),
    val directors: List<String> = emptyList(),
    val writers: List<String> = emptyList(),
    val creators: List<String> = emptyList(),
    val studios: List<String> = emptyList(),
    val seasons: List<SeasonDTO> = emptyList(),
    val files: List<FileDTO> = emptyList(),
    val similar: List<String> = emptyList(),
)

@Serializable
enum class PlaybackMode {
    @SerialName("direct") DIRECT,
    @SerialName("remux") REMUX,
    @SerialName("transcode") TRANSCODE,
}

@Serializable
data class PlaybackInfo(
    val fileId: String,
    val titleId: String,
    val title: TitleSummary,
    val episode: EpisodeDTO? = null,
    val next: EpisodeDTO? = null,
    val mode: PlaybackMode = PlaybackMode.DIRECT,
    val url: String = "",
    val hlsUrl: String? = null,
    val canTranscode: Boolean = false,
    val duration: Double? = null,
    val subtitles: List<SubtitleTrack> = emptyList(),
    val audioTracks: List<AudioTrack> = emptyList(),
    val resumeAt: Double = 0.0,
    val hasFrames: Boolean = false,
    val reason: String? = null,
)

@Serializable
data class SubtitleCue(val start: Double, val end: Double, val text: String)

@Serializable
data class SubtitleResponse(val cues: List<SubtitleCue> = emptyList())

@Serializable
data class ProgressEntry(
    val fileId: String,
    val titleId: String = "",
    val position: Double = 0.0,
    val duration: Double = 0.0,
    val updatedAt: Double = 0.0,
    val finished: Boolean = false,
)

@Serializable
data class ContinueItem(
    val titleId: String,
    val fileId: String,
    val position: Double = 0.0,
    val duration: Double = 0.0,
    val progress: Double = 0.0,
    val episode: EpisodeDTO? = null,
    val updatedAt: Double = 0.0,
    val upNext: Boolean = false,
)

@Serializable
data class ProfileDTO(
    val id: String,
    val name: String = "",
    val avatar: String = "smile-blue",
    val kids: Boolean = false,
    val autoplayNext: Boolean = true,
    val autoplayPreviews: Boolean = true,
    val subtitleLang: String? = null,
    val createdAt: Double = 0.0,
)

@Serializable
data class ProfileState(
    val myList: List<String> = emptyList(),
    val ratings: Map<String, Int> = emptyMap(),
    val progress: Map<String, ProgressEntry> = emptyMap(),
    val hiddenFromContinue: List<String> = emptyList(),
) {
    companion object {
        val EMPTY = ProfileState()
    }
}

@Serializable
data class AuthStatus(val required: Boolean = false, val authenticated: Boolean = false)

@Serializable
data class HealthInfo(val ok: Boolean = false, val version: String? = null)

@Serializable
data class OkResponse(val ok: Boolean? = null)

@Serializable
data class KeyframeResponse(val t: Double)

@Serializable
data class ErrorResponse(val error: String? = null)
