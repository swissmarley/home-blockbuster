import SwiftUI

struct HomeView: View {
    @Environment(AppModel.self) private var app
    @State private var filter: BrowseFilter = .all
    @State private var scrolled = false

    private var scoped: [TitleSummary] {
        app.titles.filter { filter == .all || $0.kind.rawValue == filter.rawValue }
    }

    private var rows: [RowDef] {
        Rows.build(titles: app.titles, titleMap: app.titleMap, state: app.state, continueItems: app.continueItems,
                   profileName: app.profile?.name ?? "You", filter: filter)
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 26) {
                if let hero = Rows.billboard(scoped, seed: "\(app.profile?.id ?? "")-\(filter.rawValue)-\(Calendar.current.component(.day, from: Date()))") {
                    BillboardView(title: hero)
                }
                ForEach(rows) { row in
                    RowView(row: row)
                }
                if !app.libraryLoading && app.titles.isEmpty {
                    emptyLibrary
                }
                Color.clear.frame(height: 20)
            }
        }
        .ignoresSafeArea(edges: .top)
        .background(Theme.background)
        .scrollIndicators(.hidden)
        .modifier(ScrollFlag(scrolled: $scrolled))
        .refreshable { await app.reloadLibrary() }
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .toolbar(.hidden, for: .navigationBar)
        .overlay {
            if app.libraryLoading && app.titles.isEmpty {
                ProgressView().tint(.white).scaleEffect(1.3)
            }
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack {
                LogoMark().fill(Theme.red).frame(width: 34, height: 34)
                Spacer()
                ProfileBadge()
            }
            HStack(spacing: 8) {
                ForEach([BrowseFilter.show, .movie], id: \.self) { f in
                    Button {
                        withAnimation(.snappy) { filter = filter == f ? .all : f }
                    } label: {
                        Text(f.label)
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(filter == f ? Color.white.opacity(0.25) : .clear, in: Capsule())
                            .overlay(Capsule().stroke(Color.white.opacity(0.45), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                if filter != .all {
                    Button {
                        withAnimation(.snappy) { filter = .all }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.caption.weight(.bold))
                            .frame(width: 30, height: 30)
                            .overlay(Circle().stroke(Color.white.opacity(0.45)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Show everything")
                }
                Spacer()
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .background {
            ZStack {
                LinearGradient(colors: [.black.opacity(0.85), .black.opacity(0.0)], startPoint: .top, endPoint: .bottom)
                Rectangle().fill(.ultraThinMaterial).overlay(Color.black.opacity(0.55)).opacity(scrolled ? 1 : 0)
            }
            .ignoresSafeArea(edges: .top)
            .animation(.easeOut(duration: 0.2), value: scrolled)
        }
    }

    private var emptyLibrary: some View {
        ContentUnavailableView {
            Label(app.libraryError == nil ? "Nothing here yet" : "Couldn't load your library", systemImage: app.libraryError == nil ? "film.stack" : "wifi.exclamationmark")
        } description: {
            Text(app.libraryError ?? "Add a library on the server in Settings → Libraries (from a browser), then pull down to refresh.")
        } actions: {
            Button("Try Again") { Task { await app.reloadLibrary() } }
        }
        .padding(.top, 120)
    }
}

struct BillboardView: View {
    @Environment(AppModel.self) private var app
    let title: TitleSummary

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.clear
                .frame(maxWidth: .infinity)
                .frame(height: 560)
                .overlay { RemoteImage(path: title.images.poster ?? title.images.hero, maxPixel: 1400) }
                .clipped()
            LinearGradient(stops: [
                .init(color: .black.opacity(0.5), location: 0),
                .init(color: .clear, location: 0.25),
                .init(color: .clear, location: 0.5),
                .init(color: Theme.background, location: 1),
            ], startPoint: .top, endPoint: .bottom)
            VStack(spacing: 14) {
                if let logo = title.images.logo {
                    RemoteImage(path: logo, contentMode: .fit, maxPixel: 800) { Color.clear }
                        .frame(maxWidth: 260, maxHeight: 110)
                } else {
                    Text(title.name)
                        .font(.system(size: 38, weight: .black))
                        .multilineTextAlignment(.center)
                        .shadow(radius: 8)
                }
                Text(title.genres.prefix(3).joined(separator: " • "))
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white.opacity(0.9))
                HStack(spacing: 12) {
                    Button {
                        if let file = playTarget { app.play(fileId: file, titleId: title.id) }
                    } label: {
                        Label("Play", systemImage: "play.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(playTarget == nil || !title.isAvailable)

                    Button {
                        Task { await app.toggleList(title.id) }
                    } label: {
                        Label("My List", systemImage: app.isInList(title.id) ? "checkmark" : "plus")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .frame(maxWidth: 360)
                NavigationLink(value: TitleRoute(id: title.id)) {
                    Label("Info", systemImage: "info.circle").font(.footnote.weight(.semibold))
                }
                .foregroundStyle(.white)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 8)
        }
        .frame(height: 560)
    }

    /// Resume where Continue Watching points, else the default file.
    private var playTarget: String? {
        app.continueItems.first { $0.titleId == title.id }?.fileId ?? title.playFileId
    }
}

/// Sets `scrolled` once the page has moved past the billboard's top (iOS 18+; always solid on 17).
private struct ScrollFlag: ViewModifier {
    @Binding var scrolled: Bool
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top > 40
            } action: { _, value in
                scrolled = value
            }
        } else {
            content.onAppear { scrolled = true }
        }
    }
}
