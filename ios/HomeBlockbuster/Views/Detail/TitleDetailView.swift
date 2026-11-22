import SwiftUI

struct TitleDetailView: View {
    @Environment(AppModel.self) private var app
    let titleId: String

    @State private var detail: TitleDetail?
    @State private var error: String?
    @State private var season: Int?
    @State private var tab: DetailTab = .episodes

    private enum DetailTab: Hashable { case episodes, similar }

    private var summary: TitleSummary? { app.titleMap[titleId] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                header
                if let detail {
                    content(detail)
                } else if let error {
                    ContentUnavailableView("Couldn't load this title", systemImage: "exclamationmark.triangle", description: Text(error))
                        .padding(.top, 40)
                } else {
                    ProgressView().tint(.white).frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
        }
        .background(Theme.background)
        .ignoresSafeArea(edges: .top)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task(id: "\(titleId)-\(app.libraryVersion)") { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let client = app.client else { return }
        do {
            let d = try await client.title(titleId, profileId: app.profile?.id)
            detail = d
            error = nil
            if season == nil || !d.seasons.contains(where: { $0.number == season }) {
                let resumeSeason = resumeEpisode(d)?.season
                season = resumeSeason ?? d.seasons.first(where: { $0.number > 0 })?.number ?? d.seasons.first?.number
            }
            if d.seasons.isEmpty { tab = .similar }
        } catch is CancellationError {
        } catch {
            if detail == nil { self.error = error.localizedDescription }
        }
    }

    // MARK: Header

    private var header: some View {
        let images = detail?.images ?? summary?.images
        return ZStack(alignment: .bottomLeading) {
            // Overlay keeps the fill image from widening the page.
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: 300)
                .overlay { RemoteImage(path: images?.backdrop ?? images?.card ?? images?.thumb ?? images?.poster, maxPixel: 1400) }
                .overlay { PreviewVideoLayer(id: previewId) }
                .clipped()
            LinearGradient(colors: [.black.opacity(0.4), .clear, Theme.background], startPoint: .top, endPoint: .bottom)
                .allowsHitTesting(false)
            if let logo = images?.logo {
                RemoteImage(path: logo, contentMode: .fit, maxPixel: 700) { Color.clear }
                    .frame(maxWidth: 220, maxHeight: 80, alignment: .bottomLeading)
                    .padding(16)
            }
            PreviewControlButton(id: previewId)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .frame(height: 300)
        .onAppear { startPreview() }
        .onChange(of: summary?.id) { _, _ in startPreview() }
        .onDisappear { PreviewCenter.shared.release(previewId) }
    }

    private var previewId: String { "page-\(titleId)" }

    private func startPreview() {
        guard let summary else { return }
        PreviewCenter.shared.request(previewId, title: summary, app: app, priority: .page, delay: .seconds(1.2))
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ d: TitleDetail) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(d.name).font(.system(size: 26, weight: .bold))
            metaLine(d)
            playButtons(d)
            if let tagline = d.tagline, !tagline.isEmpty {
                Text(tagline).font(.subheadline.italic()).foregroundStyle(Theme.secondaryText)
            }
            Text(d.overview).font(.subheadline)
            credits(d)
            actions(d)
            if !d.seasons.isEmpty || !d.similar.isEmpty {
                tabs(d)
            }
            about(d)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 30)
    }

    private func metaLine(_ d: TitleDetail) -> some View {
        HStack(spacing: 8) {
            if let match = Format.matchPercent(d.rating) {
                Text("\(match)% Match").foregroundStyle(Theme.match).fontWeight(.semibold)
            }
            if let year = d.year { Text(String(year)) }
            if let m = d.maturity {
                Text(m).font(.caption.weight(.semibold)).padding(.horizontal, 5).padding(.vertical, 1)
                    .background(Color.white.opacity(0.2), in: RoundedRectangle(cornerRadius: 2))
            }
            if let len = Format.length(kind: d.kind, runtime: d.runtime, seasonCount: d.seasonCount, episodeCount: d.episodeCount) {
                Text(len)
            }
            if let q = d.quality {
                Text(q).font(.caption2.weight(.bold)).padding(.horizontal, 4).padding(.vertical, 1)
                    .overlay(RoundedRectangle(cornerRadius: 2).stroke(Theme.secondaryText))
            }
        }
        .font(.subheadline)
        .foregroundStyle(Theme.secondaryText)
    }

    /// The episode/file Continue Watching points at, if any.
    private func resumeEpisode(_ d: TitleDetail) -> EpisodeDTO? {
        guard let item = app.continueItems.first(where: { $0.titleId == d.id }) else { return nil }
        return d.seasons.flatMap(\.episodes).first { $0.fileId == item.fileId }
    }

    private func playButtons(_ d: TitleDetail) -> some View {
        let item = app.continueItems.first { $0.titleId == d.id }
        let fileId = item?.fileId ?? d.playFileId
        let progress = fileId.flatMap { app.progress(for: $0) }
        let resuming = progress.map { !$0.finished && $0.position > 15 } ?? false
        let episode = resumeEpisode(d)
        var label = resuming ? "Resume" : "Play"
        if let episode, d.kind == .show || d.episodeCount > 1 { label += " \(episode.code)" }
        return VStack(spacing: 8) {
            Button {
                if let fileId { app.play(fileId: fileId, titleId: d.id) }
            } label: {
                Label(label, systemImage: "play.fill")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(fileId == nil || !(d.available ?? true))
            if let progress, resuming, progress.duration > 0 {
                HStack(spacing: 8) {
                    ProgressView(value: min(1, progress.position / progress.duration)).tint(Theme.red)
                    Text(Format.progressLabel(position: progress.position, duration: progress.duration) ?? "")
                        .font(.caption).foregroundStyle(Theme.secondaryText)
                }
                Button {
                    if let fileId { app.play(fileId: fileId, titleId: d.id, fromStart: true) }
                } label: {
                    Label("Play from Beginning", systemImage: "backward.end.fill")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            if !(d.available ?? true) {
                Label("The drive or share with this title is offline.", systemImage: "externaldrive.badge.xmark")
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
    }

    @ViewBuilder
    private func credits(_ d: TitleDetail) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if !d.cast.isEmpty {
                Text("Cast: ").foregroundStyle(Theme.tertiaryText) + Text(d.cast.prefix(4).map(\.name).joined(separator: ", "))
            }
            let makers = d.kind == .show ? d.creators : d.directors
            if !makers.isEmpty {
                Text(d.kind == .show ? "Creators: " : "Director: ").foregroundStyle(Theme.tertiaryText) + Text(makers.prefix(3).joined(separator: ", "))
            }
        }
        .font(.caption)
        .foregroundStyle(Theme.secondaryText)
        .lineLimit(2)
    }

    private func actions(_ d: TitleDetail) -> some View {
        let rating = app.rating(d.id)
        return HStack(spacing: 28) {
            Button {
                Task { await app.toggleList(d.id) }
            } label: {
                IconActionLabel(systemImage: app.isInList(d.id) ? "checkmark" : "plus", title: "My List")
            }
            Menu {
                Button { Task { await app.rate(d.id, -1) } } label: { Label("Not for me", systemImage: rating == -1 ? "hand.thumbsdown.fill" : "hand.thumbsdown") }
                Button { Task { await app.rate(d.id, 1) } } label: { Label("I like this", systemImage: rating == 1 ? "hand.thumbsup.fill" : "hand.thumbsup") }
                Button { Task { await app.rate(d.id, 2) } } label: { Label("Love this!", systemImage: rating == 2 ? "heart.fill" : "heart") }
            } label: {
                IconActionLabel(systemImage: rating == -1 ? "hand.thumbsdown.fill" : rating == 1 ? "hand.thumbsup.fill" : rating == 2 ? "heart.fill" : "hand.thumbsup", title: "Rate")
            }
            ShareLink(item: shareText(d)) {
                IconActionLabel(systemImage: "paperplane", title: "Share")
            }
        }
        .foregroundStyle(.white)
        .padding(.vertical, 6)
    }

    private func shareText(_ d: TitleDetail) -> String {
        "\(d.name)\(d.year.map { " (\($0))" } ?? "") — on Home Blockbuster"
    }

    // MARK: Episodes / More Like This

    @ViewBuilder
    private func tabs(_ d: TitleDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 22) {
                if !d.seasons.isEmpty { tabButton("Episodes", .episodes) }
                if !d.similar.isEmpty { tabButton("More Like This", .similar) }
            }
            Divider().overlay(Color.white.opacity(0.2))
            switch tab {
            case .episodes where !d.seasons.isEmpty:
                episodes(d)
            default:
                similar(d)
            }
        }
        .padding(.top, 6)
    }

    private func tabButton(_ title: String, _ value: DetailTab) -> some View {
        Button {
            withAnimation(.snappy) { tab = value }
        } label: {
            VStack(spacing: 6) {
                Rectangle().fill(tab == value ? Theme.red : .clear).frame(height: 4)
                Text(title).font(.subheadline.bold()).foregroundStyle(tab == value ? .white : Theme.secondaryText)
            }
            .fixedSize()
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func episodes(_ d: TitleDetail) -> some View {
        if d.seasons.count > 1 {
            Menu {
                ForEach(d.seasons) { s in
                    Button(s.name) { season = s.number }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(d.seasons.first { $0.number == season }?.name ?? "Season")
                    Image(systemName: "chevron.down").font(.caption.bold())
                }
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 4))
            }
            .foregroundStyle(.white)
        }
        let list = d.seasons.first { $0.number == season }?.episodes ?? d.seasons.first?.episodes ?? []
        LazyVStack(alignment: .leading, spacing: 18) {
            ForEach(list) { ep in
                EpisodeRow(episode: ep, titleId: d.id, fallbackArt: d.images.wide)
            }
        }
    }

    @ViewBuilder
    private func similar(_ d: TitleDetail) -> some View {
        let items = d.similar.compactMap { app.titleMap[$0] }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 100, maximum: 140), spacing: 8)], spacing: 8) {
            ForEach(items) { t in
                NavigationLink(value: TitleRoute(id: t.id)) {
                    PosterCard(title: t, width: 108)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func about(_ d: TitleDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("About \(d.name)").font(.headline).padding(.bottom, 4)
            if !d.cast.isEmpty { aboutLine("Cast", d.cast.prefix(10).map(\.name).joined(separator: ", ")) }
            if !d.directors.isEmpty { aboutLine("Director", d.directors.joined(separator: ", ")) }
            if !d.creators.isEmpty { aboutLine("Creators", d.creators.joined(separator: ", ")) }
            if !d.writers.isEmpty { aboutLine("Writers", d.writers.prefix(5).joined(separator: ", ")) }
            if !d.genres.isEmpty { aboutLine("Genres", d.genres.joined(separator: ", ")) }
            if !d.tags.isEmpty { aboutLine("This title is", d.tags.prefix(5).joined(separator: ", ")) }
            if !d.studios.isEmpty { aboutLine("Studio", d.studios.prefix(3).joined(separator: ", ")) }
            if let m = d.maturity { aboutLine("Maturity rating", m) }
        }
        .padding(.top, 24)
    }

    private func aboutLine(_ label: String, _ value: String) -> some View {
        (Text("\(label): ").foregroundStyle(Theme.tertiaryText) + Text(value))
            .font(.footnote)
    }
}

private struct EpisodeRow: View {
    @Environment(AppModel.self) private var app
    let episode: EpisodeDTO
    let titleId: String
    let fallbackArt: String?

    var body: some View {
        let progress = app.progress(for: episode.fileId)
        VStack(alignment: .leading, spacing: 8) {
            Button {
                app.play(fileId: episode.fileId, titleId: titleId)
            } label: {
                HStack(spacing: 12) {
                    ZStack(alignment: .bottom) {
                        RemoteImage(path: episode.still ?? fallbackArt, maxPixel: 500)
                            .frame(width: 130, height: 73)
                            .clipped()
                        Image(systemName: "play.fill")
                            .font(.system(size: 14))
                            .frame(width: 34, height: 34)
                            .background(.black.opacity(0.5), in: Circle())
                            .overlay(Circle().stroke(.white, lineWidth: 1.2))
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        if let progress, progress.duration > 0 {
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Rectangle().fill(.white.opacity(0.3))
                                    Rectangle().fill(Theme.red).frame(width: geo.size.width * (progress.finished ? 1 : min(1, progress.position / progress.duration)))
                                }
                            }
                            .frame(height: 3)
                        }
                    }
                    .frame(width: 130, height: 73)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(episode.episode). \(episode.name)")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                        if let mins = episode.runtime ?? episode.duration.map({ $0 / 60 }), let text = Format.runtime(mins) {
                            Text(text).font(.caption).foregroundStyle(Theme.secondaryText)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if !episode.overview.isEmpty {
                Text(episode.overview)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(4)
            }
        }
    }
}
