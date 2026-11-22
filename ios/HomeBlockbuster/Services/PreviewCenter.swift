import AVFoundation
import Foundation
import Observation

/// Netflix-style muted previews. One shared player: only one surface (title page, long-press peek)
/// plays at a time. The highest-priority surface that asked wins; when it goes away the next one resumes.
@Observable
@MainActor
final class PreviewCenter {
    static let shared = PreviewCenter()

    enum Priority: Int, Comparable {
        case page = 1, peek = 2
        static func < (a: Priority, b: Priority) -> Bool { a.rawValue < b.rawValue }
    }

    enum Phase: Equatable { case waiting, loading, playing, finished, failed }

    let player = AVPlayer()

    var muted: Bool {
        didSet {
            UserDefaults.standard.set(muted, forKey: Self.mutedKey)
            player.isMuted = muted
            configureAudioSession()
        }
    }

    /// Paused while the full player is up or the app is in the background.
    var suspended = false {
        didSet { if suspended != oldValue { reconcile() } }
    }

    private(set) var phases: [String: Phase] = [:]
    private(set) var current: String?

    private struct Request {
        var id: String
        var title: TitleSummary
        var priority: Priority
        var delay: Duration
        var maxSeconds: Double
        var order: Int
        weak var app: AppModel?
    }

    private static let mutedKey = "previews.muted"
    private var requests: [String: Request] = [:]
    private var order = 0
    private var startTask: Task<Void, Never>?
    private var stopTask: Task<Void, Never>?
    private var statusObservation: NSKeyValueObservation?
    private var playObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    /// Playback decisions per file, so replays and re-visits start instantly.
    private var infoCache: [String: PlaybackInfo] = [:]
    private var pendingSeek: Double?

    private init() {
        muted = UserDefaults.standard.object(forKey: Self.mutedKey) as? Bool ?? true
        player.isMuted = muted
        player.allowsExternalPlayback = false
        player.preventsDisplaySleepDuringVideoPlayback = false
    }

    func phase(_ id: String) -> Phase { phases[id] ?? .waiting }
    func isPlaying(_ id: String) -> Bool { current == id && phases[id] == .playing }

    /// Whether this title can show a preview at all for the signed-in profile.
    static func canPreview(_ title: TitleSummary?, app: AppModel) -> Bool {
        guard let title, title.previewUrl != nil, title.playFileId != nil, title.isAvailable else { return false }
        return app.profile?.autoplayPreviews ?? true
    }

    func request(_ id: String, title: TitleSummary, app: AppModel, priority: Priority,
                 delay: Duration = .seconds(1.2), maxSeconds: Double = 90) {
        guard Self.canPreview(title, app: app) else { return }
        if var existing = requests[id], existing.title.id == title.id {
            existing.app = app
            requests[id] = existing
        } else {
            order += 1
            requests[id] = Request(id: id, title: title, priority: priority, delay: delay, maxSeconds: maxSeconds, order: order, app: app)
            phases[id] = .waiting
        }
        reconcile()
    }

    func release(_ id: String) {
        requests[id] = nil
        phases[id] = nil
        reconcile()
    }

    func replay(_ id: String) {
        guard requests[id] != nil else { return }
        phases[id] = .waiting
        if current == id { stopPlayer() }
        reconcile()
    }

    // MARK: - Scheduling

    private func winner() -> Request? {
        requests.values
            .filter { phases[$0.id] != .finished && phases[$0.id] != .failed }
            .max { ($0.priority, $0.order) < ($1.priority, $1.order) }
    }

    private func reconcile() {
        let next = suspended ? nil : winner()
        if next?.id == current { return }
        if let current, phases[current] == .playing || phases[current] == .loading {
            // Lost the slot: it can start again later.
            phases[current] = .waiting
        }
        stopPlayer()
        guard let next else { return }
        current = next.id
        startTask = Task { [weak self] in
            try? await Task.sleep(for: next.delay)
            guard let self, !Task.isCancelled, self.current == next.id else { return }
            await self.start(next)
        }
    }

    private func stopPlayer() {
        startTask?.cancel()
        stopTask?.cancel()
        statusObservation = nil
        playObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        pendingSeek = nil
        player.pause()
        player.replaceCurrentItem(with: nil)
        current = nil
    }

    private func finish(_ id: String, failed: Bool = false) {
        guard current == id else { return }
        phases[id] = failed ? .failed : .finished
        stopPlayer()
        reconcile()
    }

    // MARK: - Playback

    private func start(_ req: Request) async {
        guard let app = req.app, let client = app.client, let fileId = req.title.playFileId else {
            return finish(req.id, failed: true)
        }
        phases[req.id] = .loading
        let info: PlaybackInfo
        if let cached = infoCache[fileId] {
            info = cached
        } else {
            do {
                info = try await client.playback(fileId: fileId, profileId: app.profile?.id)
                infoCache[fileId] = info
            } catch {
                return finish(req.id, failed: true)
            }
        }
        guard current == req.id, !Task.isCancelled else { return }

        let duration = info.duration ?? 0
        // Skip opening credits on anything long enough to have them (same rule as the web app).
        let offset = duration >= 600 ? (duration * 0.12).rounded() : 0
        let url: URL?
        pendingSeek = nil
        switch info.mode {
        case .direct:
            url = client.url(info.url)
            pendingSeek = offset > 0 ? offset : nil
        case .remux:
            // Cheap stream copy into HLS. Never ask the server to fully transcode just for a preview.
            let session = "preview" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
            url = info.hlsUrl.flatMap {
                client.url($0.replacingOccurrences(of: "{session}", with: String(session)) + "&start=\(Int(offset))&maxh=720")
            }
        case .transcode:
            url = nil
        }
        guard let url else { return finish(req.id, failed: true) }

        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": client.authHeaders])
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = 8
        item.preferredMaximumResolution = CGSize(width: 1280, height: 720)
        let id = req.id
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let status = item.status
            Task { @MainActor in
                guard let self, self.current == id else { return }
                if status == .failed { self.finish(id, failed: true) }
                if status == .readyToPlay, let seek = self.pendingSeek {
                    self.pendingSeek = nil
                    await self.player.seek(to: CMTime(seconds: seek, preferredTimescale: 600))
                    if self.current == id { self.player.play() }
                }
            }
        }
        playObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let playing = player.timeControlStatus == .playing
            Task { @MainActor in
                guard let self, self.current == id, playing, self.phases[id] == .loading else { return }
                self.phases[id] = .playing
                self.stopTask = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(req.maxSeconds))
                    guard !Task.isCancelled else { return }
                    self?.finish(id)
                }
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.finish(id) }
        }
        configureAudioSession()
        player.isMuted = muted
        player.replaceCurrentItem(with: item)
        if pendingSeek == nil { player.play() }
    }

    /// Muted previews mix with whatever the user is listening to; sound takes over like normal playback.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        if muted {
            try? session.setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        } else {
            try? session.setCategory(.playback, mode: .moviePlayback)
        }
        try? session.setActive(true)
    }

    /// The full player calls this before it starts so it always gets the normal movie session.
    static func prepareForFullPlayback() {
        shared.suspended = true
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
    }
}
