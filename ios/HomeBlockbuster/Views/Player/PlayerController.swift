import AVFoundation
import Foundation
import Observation

/// Drives one playback session: picks direct play or the server's HLS conversion, keeps the absolute
/// position (HLS streams start at `streamStart`), loads subtitles and syncs progress to the profile.
@Observable
@MainActor
final class PlayerController {
    let player = AVPlayer()

    private(set) var info: PlaybackInfo?
    private(set) var loading = true
    private(set) var buffering = false
    var error: String?

    private(set) var isPlaying = false
    /// Seconds from the start of the file.
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    private(set) var rate: Float = 1

    private(set) var subtitle: SubtitleTrack?
    private(set) var cueText: String?
    private(set) var audioIndex: Int?

    private(set) var ended = false
    private(set) var countdown: Int?

    private weak var app: AppModel?
    private var client: APIClient?
    private var profile: ProfileDTO?
    private var preferences = AppPreferences()

    private var fileId: String
    private var streamStart: Double = 0
    private var cues: [SubtitleCue] = []
    private var cueIndex = 0
    private var timeObserver: Any?
    private var playerObservation: NSKeyValueObservation?
    private var itemObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var lastReport: Date = .distantPast
    private var lastReportedPosition: Double = -1
    private var triedConversion = false
    private var pendingSeek: Double?
    private var countdownTask: Task<Void, Never>?
    private var loadGeneration = 0

    init(fileId: String) {
        self.fileId = fileId
        player.allowsExternalPlayback = true
        player.automaticallyWaitsToMinimizeStalling = true
    }

    var title: TitleSummary? { info?.title }
    var episode: EpisodeDTO? { info?.episode }
    var next: EpisodeDTO? { info?.next }
    var isStreamed: Bool { info.map { $0.mode != .direct } ?? false }
    var showsNextButton: Bool { next != nil && duration > 0 && (ended || duration - position < 40) }

    // MARK: - Lifecycle

    func start(app: AppModel, fromStart: Bool) async {
        PreviewCenter.prepareForFullPlayback()
        self.app = app
        client = app.client
        profile = app.profile
        preferences = app.preferences
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        playerObservation = player.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            let status = p.timeControlStatus
            Task { @MainActor in
                self?.isPlaying = status != .paused
                self?.buffering = status == .waitingToPlayAtSpecifiedRate
            }
        }
        await load(position: fromStart ? 0 : nil)
    }

    func stop() {
        countdownTask?.cancel()
        reportProgress(force: true)
        player.pause()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
        playerObservation = nil
        itemObservation = nil
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = nil
        player.replaceCurrentItem(with: nil)
    }

    /// (Re)load the current file. `position` nil = resume point from the server.
    private func load(position requested: Double?, audio: Int? = nil, force: Bool = false) async {
        guard let client else { return }
        loadGeneration += 1
        let generation = loadGeneration
        loading = true
        error = nil
        ended = false
        countdown = nil
        countdownTask?.cancel()
        do {
            let info = try await client.playback(fileId: fileId, profileId: profile?.id, audio: audio ?? audioIndex,
                                                 force: force || preferences.alwaysConvert)
            guard generation == loadGeneration else { return }
            let firstLoad = self.info?.fileId != info.fileId
            self.info = info
            if audioIndex == nil || firstLoad { audioIndex = audio ?? info.audioTracks.first(where: \.default)?.index }
            duration = info.duration ?? 0
            let target = requested ?? info.resumeAt
            try await open(info, at: target, generation: generation)
            if firstLoad { autoSelectSubtitles(info) }
        } catch is CancellationError {
        } catch {
            guard generation == loadGeneration else { return }
            loading = false
            self.error = error.localizedDescription
        }
    }

    private func open(_ info: PlaybackInfo, at target: Double, generation: Int) async throws {
        guard let client else { return }
        let url: URL
        if info.mode == .direct {
            guard let u = client.url(info.url) else { throw APIError(status: 0, message: "Invalid stream address.") }
            url = u
            streamStart = 0
            pendingSeek = target > 1 ? target : nil
        } else {
            guard let template = info.hlsUrl else {
                throw APIError(status: 0, message: "This video needs to be converted for iPhone, and this server is too old to do that. Update Home Blockbuster on the server (docker compose pull && docker compose up -d).")
            }
            var start = max(0, target)
            if info.mode == .remux && start > 0 {
                // A copied video stream can only start on a keyframe; ask where that is so the clock stays right.
                start = (try? await client.keyframe(fileId: info.fileId, at: start)) ?? start
            }
            guard generation == loadGeneration else { return }
            let session = UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(16)
            let path = template.replacingOccurrences(of: "{session}", with: String(session))
                + "&start=\(String(format: "%.3f", start))&maxh=\(preferences.quality.maxHeight)"
            guard let u = client.url(path) else { throw APIError(status: 0, message: "Invalid stream address.") }
            url = u
            streamStart = start
            pendingSeek = nil
        }
        position = target
        let asset = AVURLAsset(url: url, options: ["AVURLAssetHTTPHeaderFieldsKey": client.authHeaders])
        let item = AVPlayerItem(asset: asset)
        item.preferredForwardBufferDuration = info.mode == .direct ? 0 : 30
        if info.mode != .direct, preferences.quality != .original {
            item.preferredMaximumResolution = CGSize(width: preferences.quality.maxHeight * 16 / 9, height: preferences.quality.maxHeight)
        }
        itemObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let status = item.status
            let message = item.error?.localizedDescription
            Task { @MainActor in self?.itemStatusChanged(status, message: message, generation: generation) }
        }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.didEnd() }
        }
        player.replaceCurrentItem(with: item)
        player.playImmediately(atRate: rate)
    }

    private func itemStatusChanged(_ status: AVPlayerItem.Status, message: String?, generation: Int) {
        guard generation == loadGeneration else { return }
        switch status {
        case .readyToPlay:
            loading = false
            if let seek = pendingSeek {
                pendingSeek = nil
                player.seek(to: CMTime(seconds: seek, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600))
            }
            if duration <= 0, let d = player.currentItem?.duration.seconds, d.isFinite { duration = d + streamStart }
        case .failed:
            // The file looked playable but AVPlayer refused it: let the server convert it instead.
            if info?.mode == .direct, info?.canTranscode == true, !triedConversion {
                triedConversion = true
                Task { await load(position: position, force: true) }
                return
            }
            loading = false
            error = message ?? "This video can't be played."
        default:
            break
        }
    }

    // MARK: - Clock

    private func tick() {
        guard let item = player.currentItem, item.status == .readyToPlay else { return }
        let t = player.currentTime().seconds
        guard t.isFinite else { return }
        position = streamStart + t
        updateCue()
        if isPlaying { reportProgress() }
    }

    private func didEnd() {
        ended = true
        reportProgress(force: true)
        if next != nil, profile?.autoplayNext ?? true {
            startCountdown()
        }
    }

    private func startCountdown() {
        countdownTask?.cancel()
        countdown = 8
        countdownTask = Task { [weak self] in
            while let self, let c = self.countdown, c > 0 {
                try? await Task.sleep(for: .seconds(1))
                if Task.isCancelled { return }
                self.countdown = c - 1
            }
            guard let self, !Task.isCancelled else { return }
            await self.playNext()
        }
    }

    func cancelCountdown() {
        countdownTask?.cancel()
        countdown = nil
    }

    // MARK: - Controls

    func togglePlay() {
        if isPlaying { player.pause(); reportProgress(force: true) } else {
            if ended { seek(to: 0) }
            player.playImmediately(atRate: rate)
        }
    }

    func skip(_ delta: Double) { seek(to: position + delta) }

    func setRate(_ r: Float) {
        rate = r
        if isPlaying { player.rate = r }
    }

    func seek(to absolute: Double) {
        let target = max(0, duration > 0 ? min(absolute, duration - 1) : absolute)
        ended = false
        cancelCountdown()
        position = target
        cueIndex = 0
        if !isStreamed {
            player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            return
        }
        // Inside what the server has converted so far: seek natively. Further: restart the conversion there.
        let relative = target - streamStart
        let ranges = player.currentItem?.seekableTimeRanges.map(\.timeRangeValue) ?? []
        if relative >= 0, ranges.contains(where: { relative >= $0.start.seconds && relative <= $0.end.seconds - 2 }) {
            player.seek(to: CMTime(seconds: relative, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        } else {
            Task { await load(position: target) }
        }
    }

    func selectAudio(_ index: Int) {
        guard index != audioIndex else { return }
        audioIndex = index
        let at = position
        Task { await load(position: at, audio: index) }
    }

    func selectSubtitle(_ track: SubtitleTrack?) {
        subtitle = track
        cues = []
        cueIndex = 0
        cueText = nil
        guard let track, let client, let info else { return }
        Task {
            do {
                let loaded = try await client.subtitles(fileId: info.fileId, subId: track.id)
                guard self.subtitle?.id == track.id else { return }
                cues = loaded.sorted { $0.start < $1.start }
                updateCue()
            } catch {
                app?.toast = "Couldn't load subtitles: \(error.localizedDescription)"
            }
        }
    }

    private func autoSelectSubtitles(_ info: PlaybackInfo) {
        guard subtitle == nil else { return }
        if let lang = profile?.subtitleLang?.lowercased(),
           let track = info.subtitles.first(where: { ($0.language ?? "").lowercased().hasPrefix(lang) && !$0.forced })
            ?? info.subtitles.first(where: { ($0.language ?? "").lowercased().hasPrefix(lang) }) {
            selectSubtitle(track)
        } else if let forced = info.subtitles.first(where: \.forced) {
            selectSubtitle(forced)
        }
    }

    private func updateCue() {
        guard !cues.isEmpty else {
            if cueText != nil { cueText = nil }
            return
        }
        let t = position
        if cueIndex >= cues.count || cues[cueIndex].start > t { cueIndex = 0 }
        while cueIndex < cues.count - 1 && cues[cueIndex].end < t { cueIndex += 1 }
        let cue = cues[cueIndex]
        let text = cue.start <= t && t <= cue.end ? cue.text : nil
        if text != cueText { cueText = text }
    }

    func playNext() async {
        guard let next else { return }
        await switchTo(fileId: next.fileId, fromStart: true)
    }

    /// Jump to another episode of the same title. Picked from the list it resumes where you left off.
    func switchTo(fileId newFile: String, fromStart: Bool = false) async {
        guard newFile != info?.fileId || error != nil else { return }
        reportProgress(force: true)
        if let info, duration > 0 {
            // Keep the episode list's progress bars current without a round trip.
            progressOverrides[info.fileId] = ProgressEntry(fileId: info.fileId, titleId: info.titleId, position: ended ? duration : position,
                                                           duration: duration, updatedAt: Date().timeIntervalSince1970 * 1000,
                                                           finished: ended || duration - position < 60)
        }
        player.pause()
        fileId = newFile
        subtitle = nil
        cues = []
        cueText = nil
        audioIndex = nil
        triedConversion = false
        lastReportedPosition = -1
        position = 0
        duration = 0
        await load(position: fromStart ? 0 : nil)
    }

    // MARK: - Episodes

    /// Seasons and episodes of the playing title, for the in-player episode list.
    private(set) var detail: TitleDetail?
    private(set) var detailLoading = false
    private var progressOverrides: [String: ProgressEntry] = [:]

    var hasEpisodes: Bool {
        guard let title else { return false }
        return info?.episode != nil && (title.kind == .show || title.episodeCount > 1)
    }

    func loadEpisodes() async {
        guard let client, let titleId = info?.titleId, detail?.id != titleId, !detailLoading else { return }
        detailLoading = true
        defer { detailLoading = false }
        detail = try? await client.title(titleId, profileId: profile?.id)
    }

    /// Saved progress for an episode, including what was watched in this session.
    func progress(for fileId: String) -> ProgressEntry? {
        if fileId == info?.fileId, duration > 0 {
            return ProgressEntry(fileId: fileId, titleId: info?.titleId ?? "", position: position, duration: duration, updatedAt: 0, finished: false)
        }
        return progressOverrides[fileId] ?? app?.progress(for: fileId)
    }

    func retry() {
        Task { await load(position: position) }
    }

    // MARK: - Progress

    private func reportProgress(force: Bool = false) {
        guard let client, let profile, let info, duration > 0 else { return }
        let pos = ended ? duration : position
        guard pos > 0, abs(pos - lastReportedPosition) >= 1 else { return }
        guard force || Date().timeIntervalSince(lastReport) >= 10 else { return }
        lastReport = Date()
        lastReportedPosition = pos
        let fileId = info.fileId
        let total = duration
        Task.detached {
            _ = try? await client.progress(profile.id, fileId: fileId, position: pos, duration: total)
        }
    }
}
