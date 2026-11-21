import SwiftUI

struct SearchView: View {
    @Environment(AppModel.self) private var app
    @State private var query = ""

    private let columns = [GridItem(.adaptive(minimum: 104, maximum: 140), spacing: 8)]

    var body: some View {
        ScrollView {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                suggestions
            } else {
                let results = Rows.search(app.titles, query)
                if results.isEmpty {
                    ContentUnavailableView.search(text: query).padding(.top, 60)
                } else {
                    LazyVGrid(columns: columns, spacing: 8) {
                        ForEach(results) { title in
                            NavigationLink(value: TitleRoute(id: title.id)) {
                                PosterCard(title: title, width: 108)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(16)
                }
            }
        }
        .background(Theme.background)
        .navigationTitle("Search")
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Titles, people, genres")
        .autocorrectionDisabled()
    }

    private var suggestions: some View {
        LazyVStack(alignment: .leading, spacing: 2) {
            Text("Top Searches")
                .font(.title3.bold())
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            ForEach(app.titles.sorted { Rows.trendScore($0) > Rows.trendScore($1) }.prefix(20)) { title in
                NavigationLink(value: TitleRoute(id: title.id)) {
                    HStack(spacing: 12) {
                        RemoteImage(path: title.images.wide ?? title.images.poster, maxPixel: 400)
                            .frame(width: 130, height: 73)
                            .clipShape(RoundedRectangle(cornerRadius: 3))
                        Text(title.name)
                            .font(.subheadline.weight(.medium))
                            .lineLimit(2)
                        Spacer()
                        Image(systemName: "play.circle")
                            .font(.system(size: 28, weight: .light))
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 3)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct MyListView: View {
    @Environment(AppModel.self) private var app
    private let columns = [GridItem(.adaptive(minimum: 104, maximum: 140), spacing: 8)]

    var body: some View {
        let items = app.state.myList.compactMap { app.titleMap[$0] }
        ScrollView {
            if items.isEmpty {
                ContentUnavailableView {
                    Label("Your list is empty", systemImage: "plus.rectangle.on.rectangle")
                } description: {
                    Text("Tap My List on any title to save it here.")
                }
                .padding(.top, 80)
            } else {
                LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(items) { title in
                        NavigationLink(value: TitleRoute(id: title.id)) {
                            PosterCard(title: title, width: 108)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button(role: .destructive) {
                                Task { await app.toggleList(title.id) }
                            } label: {
                                Label("Remove from My List", systemImage: "minus.circle")
                            }
                        }
                    }
                }
                .padding(16)
            }
        }
        .background(Theme.background)
        .navigationTitle("My List")
        .refreshable { await app.refreshProfileState() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { ProfileBadge() }
        }
    }
}
