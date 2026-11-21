import Foundation

/// A saved Home Blockbuster instance ("Home", "Alex's place"…). The session cookie lives in the Keychain.
struct ServerConnection: Codable, Identifiable, Hashable {
    var id: UUID = UUID()
    var name: String
    /// Normalized base URL, e.g. "http://192.168.1.20:8585".
    var url: String
    var createdAt: Date = Date()
    var lastUsedAt: Date?
    /// Profile chosen last time on this server.
    var lastProfileId: String?
    /// Skip "Who's watching?" and open the last profile directly.
    var rememberProfile: Bool = false
    /// Server version seen on the last connection.
    var version: String?

    var baseURL: URL? { URL(string: url) }

    var displayHost: String {
        guard let u = URL(string: url), let host = u.host() else { return url }
        if let port = u.port { return "\(host):\(port)" }
        return host
    }

    /// Accepts "nas.local", "192.168.1.20:8585", "https://media.example.com/" and returns a clean base URL.
    static func normalize(_ input: String) -> String? {
        var text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let hadScheme = text.lowercased().hasPrefix("http://") || text.lowercased().hasPrefix("https://")
        if !hadScheme { text = "http://" + text }
        guard var comps = URLComponents(string: text), let host = comps.host, !host.isEmpty else { return nil }
        comps.scheme = comps.scheme?.lowercased()
        // "nas.local" alone means the server's default port; "http://nas.local" means port 80 (e.g. a proxy).
        if comps.port == nil && !hadScheme {
            comps.port = 8585
        }
        var path = comps.path
        while path.hasSuffix("/") { path.removeLast() }
        // Users sometimes paste a deep link; keep only a reverse-proxy prefix, never an app route.
        if let range = path.range(of: "/api") { path = String(path[..<range.lowerBound]) }
        comps.path = path
        comps.query = nil
        comps.fragment = nil
        return comps.url?.absoluteString
    }
}

/// Per-device playback preferences.
struct AppPreferences: Codable, Hashable {
    enum Quality: String, Codable, CaseIterable, Identifiable {
        case original, p1080, p720, p480
        var id: String { rawValue }
        var label: String {
            switch self {
            case .original: "Best available"
            case .p1080: "1080p"
            case .p720: "720p (saves data)"
            case .p480: "480p (lowest data)"
            }
        }
        /// `maxh` for server-side transcodes.
        var maxHeight: Int {
            switch self {
            case .original: 2160
            case .p1080: 1080
            case .p720: 720
            case .p480: 480
            }
        }
    }

    var quality: Quality = .p1080
    /// Ask the server to convert every video instead of playing files directly.
    var alwaysConvert: Bool = false
    var subtitleSize: Double = 1.0
}
