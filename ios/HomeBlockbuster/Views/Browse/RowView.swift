import SwiftUI

struct RowView: View {
    let row: RowDef

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(row.title)
                .font(.system(size: 18, weight: .bold))
                .padding(.horizontal, 16)
            ScrollView(.horizontal) {
                LazyHStack(spacing: row.style == .top10 ? 4 : 8) {
                    switch row.style {
                    case .continueWatching:
                        ForEach(row.continueItems) { item in
                            ContinueCard(item: item)
                        }
                    case .top10:
                        ForEach(Array(row.items.enumerated()), id: \.element.id) { index, title in
                            NavigationLink(value: TitleRoute(id: title.id)) {
                                Top10Card(rank: index + 1, title: title)
                            }
                            .buttonStyle(.plain)
                        }
                    case .standard:
                        ForEach(row.items) { title in
                            NavigationLink(value: TitleRoute(id: title.id)) {
                                PosterCard(title: title)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
        }
    }
}

struct PosterCard: View {
    let title: TitleSummary
    var width: CGFloat = 112

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(path: title.images.poster ?? title.images.thumb ?? title.images.wide, maxPixel: 400) {
                ZStack {
                    Theme.surface
                    Text(title.name)
                        .font(.footnote.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .padding(8)
                }
            }
            .frame(width: width, height: width * 1.5)
            .clipped()
            if title.images.poster == nil {
                Text(title.name)
                    .font(.caption.weight(.bold))
                    .lineLimit(2)
                    .padding(6)
                    .frame(width: width, alignment: .leading)
                    .background(LinearGradient(colors: [.clear, .black.opacity(0.8)], startPoint: .top, endPoint: .bottom))
            }
            if !title.isAvailable {
                Color.black.opacity(0.55)
                Image(systemName: "externaldrive.badge.xmark")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: width, height: width * 1.5)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .contentShape(Rectangle())
        .accessibilityLabel(title.name)
    }
}

struct Top10Card: View {
    let rank: Int
    let title: TitleSummary

    var body: some View {
        HStack(alignment: .bottom, spacing: -14) {
            Text("\(rank)")
                .font(.system(size: 120, weight: .black))
                .foregroundStyle(Theme.background)
                // Outlined numeral, like the TV app.
                .shadow(color: Color(white: 0.62), radius: 0, x: 1.5, y: 0)
                .shadow(color: Color(white: 0.62), radius: 0, x: -1.5, y: 0)
                .shadow(color: Color(white: 0.62), radius: 0, x: 0, y: 1.5)
                .shadow(color: Color(white: 0.62), radius: 0, x: 0, y: -1.5)
                .frame(minWidth: 58)
                .offset(y: 18)
            PosterCard(title: title, width: 100)
        }
        .frame(height: 150, alignment: .bottom)
        .clipped()
        .accessibilityLabel("Number \(rank), \(title.name)")
    }
}

struct ContinueCard: View {
    @Environment(AppModel.self) private var app
    let item: ContinueItem

    var body: some View {
        let title = app.titleMap[item.titleId]
        VStack(alignment: .leading, spacing: 0) {
            Button {
                app.play(fileId: item.fileId, titleId: item.titleId)
            } label: {
                ZStack {
                    RemoteImage(path: item.episode?.still ?? title?.images.wide ?? title?.images.poster, maxPixel: 600)
                        .frame(width: 190, height: 107)
                        .clipped()
                    Image(systemName: "play.fill")
                        .font(.system(size: 18))
                        .frame(width: 44, height: 44)
                        .background(.black.opacity(0.55), in: Circle())
                        .overlay(Circle().stroke(.white, lineWidth: 1.5))
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Resume \(title?.name ?? "")")
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(Color.white.opacity(0.25))
                    Rectangle().fill(Theme.red).frame(width: geo.size.width * (item.upNext ? 0 : item.progress))
                }
            }
            .frame(height: 3)
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title?.name ?? "")
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.caption2)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Menu {
                    NavigationLink(value: TitleRoute(id: item.titleId)) {
                        Label("Episodes & Info", systemImage: "info.circle")
                    }
                    Button {
                        app.play(fileId: item.fileId, titleId: item.titleId, fromStart: true)
                    } label: {
                        Label("Play from Beginning", systemImage: "backward.end.fill")
                    }
                    Button(role: .destructive) {
                        Task { await app.hideFromContinue(item.titleId) }
                    } label: {
                        Label("Remove from Row", systemImage: "xmark")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .rotationEffect(.degrees(90))
                        .frame(width: 28, height: 32)
                        .contentShape(Rectangle())
                }
                .foregroundStyle(Theme.secondaryText)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(Theme.surface)
        }
        .frame(width: 190)
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    private var subtitle: String {
        if let ep = item.episode {
            return item.upNext ? "Up next · \(ep.code)" : "\(ep.code) · \(Format.progressLabel(position: item.position, duration: item.duration) ?? "")"
        }
        return Format.progressLabel(position: item.position, duration: item.duration) ?? ""
    }
}
