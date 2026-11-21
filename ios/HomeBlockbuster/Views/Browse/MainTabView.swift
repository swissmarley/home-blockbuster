import SwiftUI

struct TitleRoute: Hashable {
    var id: String
}

struct MainTabView: View {
    @Environment(AppModel.self) private var app
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                HomeView()
                    .withTitleDestinations()
            }
            .tabItem { Label("Home", systemImage: "house.fill") }
            .tag(0)

            NavigationStack {
                SearchView()
                    .withTitleDestinations()
            }
            .tabItem { Label("Search", systemImage: "magnifyingglass") }
            .tag(1)

            NavigationStack {
                MyListView()
                    .withTitleDestinations()
            }
            .tabItem { Label("My List", systemImage: "plus.rectangle.on.rectangle") }
            .tag(2)

            NavigationStack {
                SettingsView()
            }
            .tabItem {
                Label("Profile", systemImage: "person.crop.circle")
            }
            .tag(3)
        }
        .toolbarBackground(.visible, for: .tabBar)
        .toolbarBackground(Color.black.opacity(0.92), for: .tabBar)
    }
}

extension View {
    func withTitleDestinations() -> some View {
        navigationDestination(for: TitleRoute.self) { route in
            TitleDetailView(titleId: route.id)
        }
    }
}

/// Small avatar button shown in the top bar.
struct ProfileBadge: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        Button {
            app.switchProfile()
        } label: {
            AvatarView(id: app.profile?.avatar ?? "smile-blue", cornerRadius: 10)
                .frame(width: 30, height: 30)
        }
        .accessibilityLabel("Switch profile")
    }
}
