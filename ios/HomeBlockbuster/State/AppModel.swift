import Foundation
import Observation
import SwiftUI

struct PlayRequest: Identifiable, Hashable {
    let id = UUID()
    var fileId: String
    var titleId: String
    /// Ignore the saved position.
    var fromStart: Bool = false
}

@Observable
@MainActor
final class AppModel {
    enum Phase: Equatable {
        case servers
        case connecting
        case login
        case profiles
        case browsing
    }

    // MARK: Saved data

    private(set) var servers: [ServerConnection] = []
    var preferences = AppPreferences() {
        didSet { savePreferences() }
    }

    // MARK: Session

    var phase: Phase = .servers
    private(set) var current: ServerConnection?
    private(set) var client: APIClient?
    private(set) var authRequired = false
    var connectError: String?

    private(set) var profiles: [ProfileDTO] = []
    private(set) var profile: ProfileDTO?

    private(set) var titles: [TitleSummary] = []
    private(set) var titleMap: [String: TitleSummary] = [:]
    private(set) var state: ProfileState = .empty
    private(set) var continueItems: [ContinueItem] = []
    private(set) var libraryLoading = false
    var libraryError: String?
    /// Bumped whenever the library is reloaded, so views can refresh details.
    private(set) var libraryVersion = 0

    var playRequest: PlayRequest?
    var toast: String?

    private let defaults = UserDefaults.standard
    private static let serversKey = "servers.v1"
    private static let prefsKey = "preferences.v1"
    private static let lastServerKey = "lastServer.v1"

    init() {
        if let data = defaults.data(forKey: Self.serversKey),
           let saved = try? JSONDecoder().decode([ServerConnection].self, from: data) {
            servers = saved
        }
        if let data = defaults.data(forKey: Self.prefsKey),
           let saved = try? JSONDecoder().decode(AppPreferences.self, from: data) {
            preferences = saved
        }
    }

    /// Reopen the server used last time (the app is usually used at one place at a time).
    func restore() async {
        guard phase == .servers, current == nil,
              let raw = defaults.string(forKey: Self.lastServerKey), let id = UUID(uuidString: raw),
              let server = servers.first(where: { $0.id == id }) else { return }
        await connect(server, silent: true)
    }

    // MARK: - Servers

    var sortedServers: [ServerConnection] {
        servers.sorted { ($0.lastUsedAt ?? $0.createdAt) > ($1.lastUsedAt ?? $1.createdAt) }
    }

    func saveServer(_ server: ServerConnection) {
        if let i = servers.firstIndex(where: { $0.id == server.id }) {
            let urlChanged = servers[i].url != server.url
            servers[i] = server
            if urlChanged { Keychain.set(nil, for: server.id.uuidString) }
            if current?.id == server.id { current = server }
        } else {
            servers.append(server)
        }
        persistServers()
    }

    func deleteServer(_ server: ServerConnection) {
        servers.removeAll { $0.id == server.id }
        Keychain.set(nil, for: server.id.uuidString)
        if current?.id == server.id { disconnect() }
        persistServers()
    }

    private func persistServers() {
        if let data = try? JSONEncoder().encode(servers) { defaults.set(data, forKey: Self.serversKey) }
    }

    private func savePreferences() {
        if let data = try? JSONEncoder().encode(preferences) { defaults.set(data, forKey: Self.prefsKey) }
    }

    private func updateCurrent(_ change: (inout ServerConnection) -> Void) {
        guard var server = current, let i = servers.firstIndex(where: { $0.id == server.id }) else { return }
        change(&server)
        servers[i] = server
        current = server
        persistServers()
    }

    /// Check an address before saving it. Returns the server version.
    nonisolated static func probe(url: String) async throws -> HealthInfo {
        guard let base = URL(string: url) else { throw APIError(status: 0, message: "That doesn't look like a valid address.") }
        let probeClient = APIClient(baseURL: base, accountKey: "probe-\(UUID().uuidString)")
        let health = try await probeClient.health()
        guard health.ok else { throw APIError(status: 0, message: "The server didn't answer like a Home Blockbuster server.") }
        return health
    }

    // MARK: - Connecting

    func connect(_ server: ServerConnection, silent: Bool = false) async {
        guard let base = server.baseURL else {
            connectError = "That server address is not valid."
            return
        }
        disconnect(keepError: false)
        current = server
        phase = .connecting
        connectError = nil
        let client = APIClient(baseURL: base, accountKey: server.id.uuidString)
        client.onUnauthorized = { [weak self] in
            Task { @MainActor in self?.sessionExpired() }
        }
        self.client = client
        do {
            let health = try await client.health()
            let auth = try await client.authStatus()
            guard self.client === client else { return }
            authRequired = auth.required
            defaults.set(server.id.uuidString, forKey: Self.lastServerKey)
            updateCurrent {
                $0.lastUsedAt = Date()
                $0.version = health.version
            }
            if auth.required && !auth.authenticated {
                client.token = nil
                phase = .login
                return
            }
            try await loadProfiles()
        } catch {
            guard self.client === client else { return }
            connectError = error.localizedDescription
            current = nil
            self.client = nil
            phase = .servers
            if silent { connectError = "Couldn't reach “\(server.name)”. \(error.localizedDescription)" }
        }
    }

    func login(password: String) async throws {
        guard let client else { return }
        try await client.login(password: password)
        try await loadProfiles()
    }

    private func loadProfiles() async throws {
        guard let client else { return }
        let list = try await client.profiles()
        profiles = list
        if let server = current, server.rememberProfile, let id = server.lastProfileId, let p = list.first(where: { $0.id == id }) {
            await select(profile: p)
        } else {
            phase = .profiles
        }
    }

    func reloadProfiles() async {
        guard let client else { return }
        if let list = try? await client.profiles() {
            profiles = list
            if let p = profile, let fresh = list.first(where: { $0.id == p.id }) { profile = fresh }
        }
    }

    private func sessionExpired() {
        guard authRequired, phase != .login, phase != .servers else { return }
        client?.token = nil
        playRequest = nil
        profile = nil
        phase = .login
    }

    func signOut() async {
        await client?.logout()
        if authRequired {
            profile = nil
            phase = .login
        } else {
            disconnect()
        }
    }

    /// Back to the server list.
    func disconnect(keepError: Bool = true) {
        defaults.removeObject(forKey: Self.lastServerKey)
        client = nil
        current = nil
        profile = nil
        profiles = []
        titles = []
        titleMap = [:]
        state = .empty
        continueItems = []
        playRequest = nil
        if !keepError { connectError = nil }
        phase = .servers
    }

    // MARK: - Profiles

    func select(profile p: ProfileDTO) async {
        profile = p
        updateCurrent { $0.lastProfileId = p.id }
        state = .empty
        continueItems = []
        titles = []
        titleMap = [:]
        phase = .browsing
        await reloadLibrary()
    }

    func switchProfile() {
        profile = nil
        playRequest = nil
        phase = .profiles
        Task { await reloadProfiles() }
    }

    var rememberProfile: Bool {
        get { current?.rememberProfile ?? false }
        set { updateCurrent { $0.rememberProfile = newValue } }
    }

    func createProfile(name: String, avatar: String, kids: Bool) async throws -> ProfileDTO {
        guard let client else { throw APIError.unreachable }
        let p = try await client.createProfile(.init(name: name, avatar: avatar, kids: kids))
        profiles.append(p)
        return p
    }

    func updateProfile(_ id: String, _ update: APIClient.ProfileUpdate) async throws {
        guard let client else { throw APIError.unreachable }
        let p = try await client.updateProfile(id, update)
        if let i = profiles.firstIndex(where: { $0.id == id }) { profiles[i] = p }
        if profile?.id == id {
            let kidsChanged = profile?.kids != p.kids
            profile = p
            if kidsChanged { await reloadLibrary() }
        }
    }

    func deleteProfile(_ id: String) async throws {
        guard let client else { throw APIError.unreachable }
        try await client.deleteProfile(id)
        profiles.removeAll { $0.id == id }
        if profile?.id == id { switchProfile() }
    }

    // MARK: - Library

    func reloadLibrary() async {
        guard let client, let profile else { return }
        libraryLoading = true
        libraryError = nil
        defer { libraryLoading = false }
        do {
            async let titlesTask = client.titles(profileId: profile.id)
            async let stateTask = client.profileState(profile.id)
            async let continueTask = client.continueWatching(profile.id)
            let (t, s, c) = try await (titlesTask, stateTask, continueTask)
            guard self.profile?.id == profile.id else { return }
            titles = t
            titleMap = Dictionary(t.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            state = s
            continueItems = c
            libraryVersion += 1
        } catch is CancellationError {
        } catch {
            libraryError = error.localizedDescription
        }
    }

    func refreshProfileState() async {
        guard let client, let profile else { return }
        async let s = try? client.profileState(profile.id)
        async let c = try? client.continueWatching(profile.id)
        if let s = await s { state = s }
        if let c = await c { continueItems = c }
    }

    func isInList(_ titleId: String) -> Bool { state.myList.contains(titleId) }

    func toggleList(_ titleId: String) async {
        guard let client, let profile else { return }
        let adding = !isInList(titleId)
        // Optimistic update.
        if adding { state.myList.insert(titleId, at: 0) } else { state.myList.removeAll { $0 == titleId } }
        do {
            state = adding ? try await client.addToList(profile.id, titleId) : try await client.removeFromList(profile.id, titleId)
        } catch {
            toast = error.localizedDescription
            await refreshProfileState()
        }
    }

    func rating(_ titleId: String) -> Int { state.ratings[titleId] ?? 0 }

    func rate(_ titleId: String, _ value: Int) async {
        guard let client, let profile else { return }
        let next = rating(titleId) == value ? 0 : value
        state.ratings[titleId] = next == 0 ? nil : next
        do { state = try await client.rate(profile.id, titleId, next) } catch { toast = error.localizedDescription }
    }

    func hideFromContinue(_ titleId: String) async {
        guard let client, let profile else { return }
        continueItems.removeAll { $0.titleId == titleId }
        if let s = try? await client.hideContinue(profile.id, titleId) { state = s }
    }

    func progress(for fileId: String) -> ProgressEntry? { state.progress[fileId] }

    // MARK: - Playback

    func play(fileId: String, titleId: String, fromStart: Bool = false) {
        playRequest = PlayRequest(fileId: fileId, titleId: titleId, fromStart: fromStart)
    }

    func playerClosed() {
        playRequest = nil
        Task { await refreshProfileState() }
    }
}
