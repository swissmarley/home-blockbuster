import SwiftUI

/// Profile, server and app settings.
struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var editingProfile: ProfileDTO?
    @State private var confirmSignOut = false

    var body: some View {
        @Bindable var app = app
        List {
            if let profile = app.profile {
                Section {
                    HStack(spacing: 14) {
                        AvatarView(id: profile.avatar).frame(width: 56, height: 56)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.name).font(.title3.bold())
                            Text(profile.kids ? "Kids profile" : "Profile").font(.subheadline).foregroundStyle(Theme.secondaryText)
                        }
                    }
                    .padding(.vertical, 4)
                    Button {
                        editingProfile = profile
                    } label: {
                        Label("Edit Profile & Playback Settings", systemImage: "slider.horizontal.3")
                    }
                    Button {
                        app.switchProfile()
                    } label: {
                        Label("Switch Profile", systemImage: "person.2")
                    }
                    Toggle(isOn: $app.rememberProfile) {
                        Label("Open this profile automatically", systemImage: "person.crop.circle.badge.checkmark")
                    }
                } header: {
                    Text("Profile")
                } footer: {
                    Text("Profile settings are saved on the server, so they're the same on every device.")
                }

                Section("Your profile on this server") {
                    LabeledContent("Autoplay next episode", value: profile.autoplayNext ? "On" : "Off")
                    LabeledContent("Subtitles", value: profile.subtitleLang.flatMap { code in Format.languages.first { $0.code == code }?.name } ?? "Off")
                    LabeledContent("My List", value: "\(app.state.myList.count) titles")
                }
            }

            Section {
                Picker(selection: $app.preferences.quality) {
                    ForEach(AppPreferences.Quality.allCases) { q in Text(q.label).tag(q) }
                } label: {
                    Label("Streaming quality", systemImage: "dial.medium")
                }
                Toggle(isOn: $app.preferences.alwaysConvert) {
                    Label("Always convert on server", systemImage: "bolt.horizontal.circle")
                }
                Picker(selection: $app.preferences.subtitleSize) {
                    Text("Small").tag(0.8)
                    Text("Medium").tag(1.0)
                    Text("Large").tag(1.3)
                    Text("Extra Large").tag(1.6)
                } label: {
                    Label("Subtitle size", systemImage: "textformat.size")
                }
            } header: {
                Text("This iPhone")
            } footer: {
                Text("Quality applies when the server converts a video. “Always convert” helps with files that stutter or don't play directly.")
            }

            if let server = app.current {
                Section {
                    LabeledContent("Server", value: server.name)
                    LabeledContent("Address", value: server.displayHost)
                    if let v = server.version { LabeledContent("Version", value: v) }
                    LabeledContent("Library", value: "\(app.titles.count) titles")
                    Button {
                        app.disconnect(keepError: false)
                    } label: {
                        Label("Switch Server", systemImage: "server.rack")
                    }
                    Button {
                        Task { await app.reloadLibrary() }
                    } label: {
                        Label("Refresh Library", systemImage: "arrow.clockwise")
                    }
                    if app.authRequired {
                        Button(role: .destructive) {
                            confirmSignOut = true
                        } label: {
                            Label("Sign Out of \(server.name)", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                } header: {
                    Text("Server")
                } footer: {
                    Text("Libraries, metadata and the server password are managed from the web app in a browser.")
                }
            }

            Section {
                LabeledContent("App version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                Link(destination: URL(string: "https://github.com/swissmarley/home-blockbuster")!) {
                    Label("Home Blockbuster on GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
                }
            } footer: {
                Text("Home Blockbuster is an independent open-source project, not affiliated with Netflix or Blockbuster.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Profile & Settings")
        .sheet(item: $editingProfile) { profile in
            ProfileEditView(profile: profile)
        }
        .confirmationDialog("Sign out of this server?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) { Task { await app.signOut() } }
        }
    }
}
