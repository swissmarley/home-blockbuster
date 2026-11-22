import SwiftUI

/// The shared preview video, faded in over the artwork once it is actually playing.
struct PreviewVideoLayer: View {
    let id: String
    var center = PreviewCenter.shared

    var body: some View {
        let playing = center.isPlaying(id)
        ZStack {
            if center.current == id {
                VideoSurface(player: center.player, fill: true)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .opacity(playing ? 1 : 0)
        .animation(.easeInOut(duration: 0.6), value: playing)
    }
}

/// Mute toggle while a preview plays, replay once it has finished.
struct PreviewControlButton: View {
    let id: String
    var center = PreviewCenter.shared

    var body: some View {
        Group {
            if center.isPlaying(id) {
                Button {
                    center.muted.toggle()
                } label: {
                    Image(systemName: center.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                        .contentTransition(.symbolEffect(.replace))
                }
                .accessibilityLabel(center.muted ? "Unmute preview" : "Mute preview")
            } else if center.phase(id) == .finished {
                Button {
                    center.replay(id)
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                }
                .accessibilityLabel("Replay preview")
            }
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(.white)
        .frame(width: 34, height: 34)
        .background(.black.opacity(0.35), in: Circle())
        .overlay(Circle().stroke(.white.opacity(0.7), lineWidth: 1))
        .transition(.opacity)
        .animation(.easeOut(duration: 0.2), value: center.phase(id))
    }
}

/// Long-press preview for a title card: the iPhone stand-in for the web app's hover card.
struct TitlePeekView: View {
    let title: TitleSummary
    let app: AppModel
    var center = PreviewCenter.shared

    private var previewId: String { "peek-\(title.id)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // No mute button here: a context-menu preview can't take taps (it would close the menu).
            ZStack {
                RemoteImage(path: title.images.wide ?? title.images.poster, maxPixel: 900)
                    .environment(app)
                PreviewVideoLayer(id: previewId)
            }
            .frame(width: 340, height: 191)
            .clipped()

            VStack(alignment: .leading, spacing: 6) {
                Text(title.name).font(.headline).lineLimit(2)
                HStack(spacing: 8) {
                    if let match = Format.matchPercent(title.rating) {
                        Text("\(match)% Match").foregroundStyle(Theme.match).fontWeight(.semibold)
                    }
                    if let year = title.year { Text(String(year)) }
                    if let m = title.maturity {
                        Text(m).font(.caption2.weight(.semibold)).padding(.horizontal, 4).padding(.vertical, 1)
                            .overlay(RoundedRectangle(cornerRadius: 2).stroke(Theme.secondaryText))
                    }
                    if let len = Format.length(kind: title.kind, runtime: title.runtime, seasonCount: title.seasonCount, episodeCount: title.episodeCount) {
                        Text(len)
                    }
                }
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
                if !title.genres.isEmpty {
                    Text(title.genres.prefix(3).joined(separator: " • ")).font(.caption)
                }
                if !title.overview.isEmpty {
                    Text(title.overview).font(.caption).foregroundStyle(Theme.secondaryText).lineLimit(3)
                }
            }
            .padding(12)
        }
        .frame(width: 340)
        .background(Theme.surface)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .onAppear {
            center.request(previewId, title: title, app: app, priority: .peek, delay: .milliseconds(350), maxSeconds: 60)
        }
        .onDisappear { center.release(previewId) }
    }
}

extension View {
    /// Long-press a card to peek at it with a playing preview, plus quick actions.
    func titlePeek(_ title: TitleSummary, app: AppModel) -> some View {
        contextMenu {
            if let file = app.continueItems.first(where: { $0.titleId == title.id })?.fileId ?? title.playFileId, title.isAvailable {
                Button { app.play(fileId: file, titleId: title.id) } label: { Label("Play", systemImage: "play.fill") }
            }
            Button {
                Task { await app.toggleList(title.id) }
            } label: {
                Label(app.isInList(title.id) ? "Remove from My List" : "Add to My List", systemImage: app.isInList(title.id) ? "checkmark" : "plus")
            }
        } preview: {
            TitlePeekView(title: title, app: app)
        }
    }
}
