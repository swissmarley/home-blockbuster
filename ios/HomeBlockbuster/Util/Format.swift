import Foundation

enum Format {
    static func runtime(_ minutes: Double?) -> String? {
        guard let minutes, minutes > 0 else { return nil }
        let h = Int(minutes) / 60
        let m = Int(minutes.rounded()) % 60
        if h == 0 { return "\(m)m" }
        return m > 0 ? "\(h)h \(m)m" : "\(h)h"
    }

    static func length(kind: TitleKind, runtime: Double?, seasonCount: Int, episodeCount: Int) -> String? {
        if kind == .movie && episodeCount < 2 { return Format.runtime(runtime) }
        if seasonCount > 1 { return "\(seasonCount) Seasons" }
        if episodeCount > 1 { return "\(episodeCount) Episodes" }
        if episodeCount == 1 { return "1 Episode" }
        return nil
    }

    static func clock(_ seconds: Double) -> String {
        let total = seconds.isFinite && seconds > 0 ? Int(seconds) : 0
        let h = total / 3600, m = (total / 60) % 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }

    static func progressLabel(position: Double, duration: Double) -> String? {
        guard duration > 0 else { return nil }
        let total = max(1, Int((duration / 60).rounded()))
        if total >= 60 {
            let left = max(1, (duration - position) / 60)
            return "\(runtime(left) ?? "") left"
        }
        return "\(Int((position / 60).rounded())) of \(total)m"
    }

    /// Netflix-style "97% Match" from the community rating.
    static func matchPercent(_ rating: Double?) -> Int? {
        guard let rating, rating > 0 else { return nil }
        return max(35, min(99, Int((52 + rating * 4.6).rounded())))
    }

    static func isRecentlyAdded(_ addedAt: Double, days: Double) -> Bool {
        Date().timeIntervalSince1970 * 1000 - addedAt < days * 86_400_000
    }

    static let languages: [(code: String, name: String)] = [
        ("en", "English"), ("de", "German"), ("fr", "French"), ("it", "Italian"), ("es", "Spanish"),
        ("pt", "Portuguese"), ("nl", "Dutch"), ("sv", "Swedish"), ("da", "Danish"), ("no", "Norwegian"),
        ("fi", "Finnish"), ("pl", "Polish"), ("cs", "Czech"), ("hu", "Hungarian"), ("ro", "Romanian"),
        ("el", "Greek"), ("tr", "Turkish"), ("ru", "Russian"), ("uk", "Ukrainian"), ("ar", "Arabic"),
        ("he", "Hebrew"), ("hi", "Hindi"), ("ja", "Japanese"), ("ko", "Korean"), ("zh", "Chinese"),
        ("th", "Thai"), ("vi", "Vietnamese"), ("id", "Indonesian"),
    ]
}
