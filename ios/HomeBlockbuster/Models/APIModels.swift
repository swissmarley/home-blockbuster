import Foundation

// Mirrors server/src/shared/types.ts. Optional where the server may send null or older servers omit a field.

enum TitleKind: String, Codable, Hashable {
    case movie, show
}

struct ImageSet: Codable, Hashable {
    var poster: String?
    var backdrop: String?
    var card: String?
    var cardHasTitle: Bool?
    var logo: String?
    var thumb: String?

    /// 16:9 art for wide cards.
    var wide: String? { card ?? backdrop ?? thumb }
    /// Big hero art.
    var hero: String? { backdrop ?? card ?? thumb ?? poster }
}

struct TitleSummary: Codable, Identifiable, Hashable {
    var id: String
    var kind: TitleKind
    var name: String
    var year: Int?
    var overview: String
    var genres: [String]
    var tags: [String]
    var rating: Double?
    var popularity: Double?
    var maturity: String?
    var runtime: Double?
    var seasonCount: Int
    var episodeCount: Int
    var quality: String?
    var images: ImageSet
    var addedAt: Double
    var releaseDate: String?
    var people: [String]
    var libraryIds: [String]
    var playFileId: String?
    var previewUrl: String?
    var source: String?
    var available: Bool?

    var isAvailable: Bool { available ?? true }
}

struct CastMember: Codable, Hashable {
    var name: String
    var character: String?
    var photo: String?
}

struct EpisodeDTO: Codable, Identifiable, Hashable {
    var id: String
    var fileId: String
    var season: Int
    var episode: Int
    var episodeEnd: Int?
    var name: String
    var overview: String
    var still: String?
    var runtime: Double?
    var airDate: String?
    var duration: Double?

    var code: String { season == 0 ? "Special \(episode)" : "S\(season):E\(episode)" }
}

struct SeasonDTO: Codable, Identifiable, Hashable {
    var number: Int
    var name: String
    var overview: String
    var poster: String?
    var episodes: [EpisodeDTO]
    var id: Int { number }
}

struct SubtitleTrack: Codable, Identifiable, Hashable {
    var id: String
    var label: String
    var language: String?
    var forced: Bool
    var source: String
}

struct AudioTrack: Codable, Identifiable, Hashable {
    var index: Int
    var label: String
    var language: String?
    var codec: String
    var channels: Int?
    var `default`: Bool
    var id: Int { index }
}

struct FileDTO: Codable, Identifiable, Hashable {
    var id: String
    var path: String
    var size: Double
    var container: String
    var duration: Double?
    var width: Int?
    var height: Int?
    var videoCodec: String?
    var audioCodecs: [String]
    var subtitles: [SubtitleTrack]
    var libraryId: String
}

struct TitleDetail: Codable, Identifiable, Hashable {
    var id: String
    var kind: TitleKind
    var name: String
    var year: Int?
    var overview: String
    var genres: [String]
    var tags: [String]
    var rating: Double?
    var maturity: String?
    var runtime: Double?
    var seasonCount: Int
    var episodeCount: Int
    var quality: String?
    var images: ImageSet
    var playFileId: String?
    var available: Bool?
    var tagline: String?
    var cast: [CastMember]
    var directors: [String]
    var writers: [String]
    var creators: [String]
    var studios: [String]
    var seasons: [SeasonDTO]
    var files: [FileDTO]
    var similar: [String]
}

enum PlaybackMode: String, Codable {
    case direct, remux, transcode
}

struct PlaybackInfo: Codable {
    var fileId: String
    var titleId: String
    var title: TitleSummary
    var episode: EpisodeDTO?
    var next: EpisodeDTO?
    var mode: PlaybackMode
    var url: String
    var hlsUrl: String?
    var canTranscode: Bool
    var duration: Double?
    var subtitles: [SubtitleTrack]
    var audioTracks: [AudioTrack]
    var resumeAt: Double
    var hasFrames: Bool
    var reason: String?
}

struct SubtitleCue: Codable, Hashable {
    var start: Double
    var end: Double
    var text: String
}

struct SubtitleResponse: Codable {
    var cues: [SubtitleCue]
}

struct ProgressEntry: Codable, Hashable {
    var fileId: String
    var titleId: String
    var position: Double
    var duration: Double
    var updatedAt: Double
    var finished: Bool
}

struct ContinueItem: Codable, Hashable, Identifiable {
    var titleId: String
    var fileId: String
    var position: Double
    var duration: Double
    var progress: Double
    var episode: EpisodeDTO?
    var updatedAt: Double
    var upNext: Bool
    var id: String { titleId }
}

struct ProfileDTO: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var avatar: String
    var kids: Bool
    var autoplayNext: Bool
    var autoplayPreviews: Bool
    var subtitleLang: String?
    var createdAt: Double
}

struct ProfileState: Codable, Hashable {
    var myList: [String]
    var ratings: [String: Int]
    var progress: [String: ProgressEntry]
    var hiddenFromContinue: [String]

    static let empty = ProfileState(myList: [], ratings: [:], progress: [:], hiddenFromContinue: [])
}

struct AuthStatus: Codable {
    var required: Bool
    var authenticated: Bool
}

struct HealthInfo: Codable {
    var ok: Bool
    var version: String?
}

struct SystemInfo: Codable {
    var version: String
    var titleCount: Int
    var fileCount: Int
    var libraryCount: Int
    var authRequired: Bool
    var onboarded: Bool
}

struct OkResponse: Codable {
    var ok: Bool?
}

struct KeyframeResponse: Codable {
    var t: Double
}
