import Foundation

struct APIError: LocalizedError, Equatable {
    var status: Int
    var message: String
    var errorDescription: String? { message }

    static let unreachable = APIError(status: 0, message: "Can't reach this Home Blockbuster server. Check the address and that your phone is on the same network.")
}

/// Talks to one Home Blockbuster server. Session cookies are handled by hand so every saved server keeps its own.
final class APIClient: @unchecked Sendable {
    static let sessionCookie = "hb_session"

    let baseURL: URL
    private let accountKey: String
    private let session: URLSession
    private let lock = NSLock()
    private var _token: String?

    /// Called on 401 for authenticated endpoints.
    var onUnauthorized: (@Sendable () -> Void)?

    init(baseURL: URL, accountKey: String) {
        self.baseURL = baseURL
        self.accountKey = accountKey
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        config.requestCachePolicy = .useProtocolCachePolicy
        config.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 0)
        session = URLSession(configuration: config)
        _token = Keychain.get(accountKey)
    }

    var token: String? {
        get { lock.withLock { _token } }
        set {
            lock.withLock { _token = newValue }
            Keychain.set(newValue, for: accountKey)
        }
    }

    /// Headers needed for any request to this server (API, images, video).
    var authHeaders: [String: String] {
        var h = ["X-Requested-With": "HomeBlockbuster"]
        if let token { h["Cookie"] = "\(Self.sessionCookie)=\(token)" }
        return h
    }

    /// Resolves a server-relative URL such as "/api/img?u=…".
    func url(_ path: String) -> URL? {
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        let base = baseURL.absoluteString.hasSuffix("/") ? String(baseURL.absoluteString.dropLast()) : baseURL.absoluteString
        return URL(string: base + (path.hasPrefix("/") ? path : "/" + path))
    }

    func authorizedRequest(_ url: URL) -> URLRequest {
        var req = URLRequest(url: url)
        for (k, v) in authHeaders { req.setValue(v, forHTTPHeaderField: k) }
        return req
    }

    // MARK: - Core

    private static let decoder = JSONDecoder()

    @discardableResult
    func send<T: Decodable>(_ method: String, _ path: String, query: [String: String?] = [:], body: (any Encodable)? = nil, as type: T.Type = T.self, timeout: TimeInterval? = nil) async throws -> T {
        guard var comps = url(path).flatMap({ URLComponents(url: $0, resolvingAgainstBaseURL: false) }) else {
            throw APIError(status: 0, message: "Invalid server address.")
        }
        let items = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }
        if !items.isEmpty { comps.queryItems = (comps.queryItems ?? []) + items }
        guard let url = comps.url else { throw APIError(status: 0, message: "Invalid server address.") }
        var req = authorizedRequest(url)
        req.httpMethod = method
        if let timeout { req.timeoutInterval = timeout }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            if (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw APIError.unreachable
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.unreachable }
        captureSession(from: http)
        if http.statusCode == 401 && !path.hasPrefix("/api/auth/") { onUnauthorized?() }
        guard (200..<300).contains(http.statusCode) else {
            var message = HTTPURLResponse.localizedString(forStatusCode: http.statusCode).capitalized
            if let err = try? Self.decoder.decode([String: String].self, from: data), let m = err["error"] {
                message = m
            } else if let text = String(data: data, encoding: .utf8), !text.isEmpty, text.count < 300, !text.contains("<") {
                message = text
            }
            throw APIError(status: http.statusCode, message: message)
        }
        if T.self == OkResponse.self && data.isEmpty { return OkResponse(ok: true) as! T }
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            #if DEBUG
            print("Decode error for \(path): \(error)")
            #endif
            throw APIError(status: http.statusCode, message: "This server sent a response the app doesn't understand. Is it a Home Blockbuster server?")
        }
    }

    private func captureSession(from response: HTTPURLResponse) {
        guard let url = response.url,
              let fields = response.allHeaderFields as? [String: String] else { return }
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: fields, for: url) where cookie.name == Self.sessionCookie {
            token = cookie.value.isEmpty ? nil : cookie.value
        }
    }

    // MARK: - Endpoints

    func health() async throws -> HealthInfo { try await send("GET", "/api/health", timeout: 8) }
    func authStatus() async throws -> AuthStatus { try await send("GET", "/api/auth/status", timeout: 8) }
    func login(password: String) async throws {
        try await send("POST", "/api/auth/login", body: ["password": password], as: OkResponse.self)
    }
    func logout() async {
        _ = try? await send("POST", "/api/auth/logout", as: OkResponse.self)
        token = nil
    }
    func system() async throws -> SystemInfo { try await send("GET", "/api/system") }

    func titles(profileId: String?) async throws -> [TitleSummary] {
        try await send("GET", "/api/titles", query: ["profile": profileId], timeout: 40)
    }
    func title(_ id: String, profileId: String?) async throws -> TitleDetail {
        try await send("GET", "/api/titles/\(id)", query: ["profile": profileId])
    }

    func profiles() async throws -> [ProfileDTO] { try await send("GET", "/api/profiles") }

    struct NewProfile: Encodable { var name: String; var avatar: String; var kids: Bool }
    func createProfile(_ p: NewProfile) async throws -> ProfileDTO { try await send("POST", "/api/profiles", body: p) }

    struct ProfileUpdate: Encodable {
        var name: String
        var avatar: String
        var kids: Bool
        var autoplayNext: Bool
        var autoplayPreviews: Bool
        var subtitleLang: String?

        func encode(to encoder: any Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(name, forKey: .name)
            try c.encode(avatar, forKey: .avatar)
            try c.encode(kids, forKey: .kids)
            try c.encode(autoplayNext, forKey: .autoplayNext)
            try c.encode(autoplayPreviews, forKey: .autoplayPreviews)
            try c.encode(subtitleLang, forKey: .subtitleLang) // explicit null clears it
        }
        enum CodingKeys: String, CodingKey { case name, avatar, kids, autoplayNext, autoplayPreviews, subtitleLang }
    }
    func updateProfile(_ id: String, _ p: ProfileUpdate) async throws -> ProfileDTO { try await send("PUT", "/api/profiles/\(id)", body: p) }
    func deleteProfile(_ id: String) async throws { try await send("DELETE", "/api/profiles/\(id)", as: OkResponse.self) }

    func profileState(_ id: String) async throws -> ProfileState { try await send("GET", "/api/profiles/\(id)/state") }
    func continueWatching(_ id: String) async throws -> [ContinueItem] { try await send("GET", "/api/profiles/\(id)/continue") }
    func addToList(_ profileId: String, _ titleId: String) async throws -> ProfileState {
        try await send("PUT", "/api/profiles/\(profileId)/list/\(titleId)")
    }
    func removeFromList(_ profileId: String, _ titleId: String) async throws -> ProfileState {
        try await send("DELETE", "/api/profiles/\(profileId)/list/\(titleId)")
    }
    func rate(_ profileId: String, _ titleId: String, _ rating: Int) async throws -> ProfileState {
        try await send("PUT", "/api/profiles/\(profileId)/ratings/\(titleId)", body: ["rating": rating])
    }
    func hideContinue(_ profileId: String, _ titleId: String) async throws -> ProfileState {
        try await send("DELETE", "/api/profiles/\(profileId)/continue/\(titleId)")
    }

    struct ProgressBody: Encodable { var fileId: String; var position: Double; var duration: Double }
    @discardableResult
    func progress(_ profileId: String, fileId: String, position: Double, duration: Double) async throws -> ProgressEntry {
        try await send("POST", "/api/profiles/\(profileId)/progress", body: ProgressBody(fileId: fileId, position: position, duration: duration))
    }

    /// Codecs AVPlayer decodes natively. No MKV/WebM: those are remuxed to HLS by the server.
    static let deviceCaps = "h264,hevc,aac,mp3,ac3,eac3"

    func playback(fileId: String, profileId: String?, audio: Int? = nil, force: Bool = false) async throws -> PlaybackInfo {
        try await send("GET", "/api/playback/\(fileId)", query: [
            "profile": profileId,
            "caps": Self.deviceCaps,
            "audio": audio.map(String.init),
            "force": force ? "1" : nil,
        ])
    }
    func keyframe(fileId: String, at t: Double) async throws -> Double {
        let r: KeyframeResponse = try await send("GET", "/api/stream/\(fileId)/keyframe", query: ["t": String(format: "%.2f", t)])
        return r.t
    }
    func subtitles(fileId: String, subId: String) async throws -> [SubtitleCue] {
        let r: SubtitleResponse = try await send("GET", "/api/subtitles/\(fileId)/\(subId)", timeout: 60)
        return r.cues
    }
}
