import SwiftUI

/// "Who's watching?"
struct ProfilePickerView: View {
    @Environment(AppModel.self) private var app
    @State private var managing = false
    @State private var editing: ProfileDTO?
    @State private var creating = false

    private let columns = [GridItem(.adaptive(minimum: 110, maximum: 150), spacing: 22)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 30) {
                    Text(managing ? "Manage Profiles" : "Who's watching?")
                        .font(.system(size: 28, weight: .semibold))
                        .padding(.top, 40)
                    LazyVGrid(columns: columns, spacing: 26) {
                        ForEach(app.profiles) { profile in
                            Button {
                                if managing {
                                    editing = profile
                                } else {
                                    Task { await app.select(profile: profile) }
                                }
                            } label: {
                                VStack(spacing: 10) {
                                    ZStack {
                                        AvatarView(id: profile.avatar)
                                        if managing {
                                            Color.black.opacity(0.5).clipShape(RoundedRectangle(cornerRadius: 6))
                                            Image(systemName: "pencil").font(.system(size: 30, weight: .semibold))
                                        }
                                    }
                                    .frame(width: 104, height: 104)
                                    Text(profile.name)
                                        .font(.subheadline)
                                        .foregroundStyle(Theme.secondaryText)
                                        .lineLimit(1)
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(managing ? "Edit \(profile.name)" : profile.name)
                        }
                        if app.profiles.count < 5 {
                            Button {
                                creating = true
                            } label: {
                                VStack(spacing: 10) {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 6).stroke(Theme.tertiaryText, lineWidth: 2)
                                        Image(systemName: "plus").font(.system(size: 40)).foregroundStyle(Theme.secondaryText)
                                    }
                                    .frame(width: 104, height: 104)
                                    Text("Add Profile").font(.subheadline).foregroundStyle(Theme.secondaryText)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 24)

                    Button(managing ? "Done" : "Manage Profiles") {
                        withAnimation { managing.toggle() }
                    }
                    .font(.headline)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 10)
                    .foregroundStyle(managing ? .black : Theme.secondaryText)
                    .background(managing ? Color.white : Color.clear, in: RoundedRectangle(cornerRadius: 4))
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(managing ? .clear : Theme.tertiaryText))
                }
                .frame(maxWidth: 700)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        app.disconnect(keepError: false)
                    } label: {
                        Label(app.current?.name ?? "Servers", systemImage: "chevron.left")
                            .labelStyle(.titleAndIcon)
                    }
                    .foregroundStyle(Theme.secondaryText)
                }
                ToolbarItem(placement: .principal) {
                    LogoMark().fill(Theme.red).frame(width: 30, height: 30)
                }
            }
            .refreshable { await app.reloadProfiles() }
            .sheet(item: $editing) { profile in
                ProfileEditView(profile: profile)
            }
            .sheet(isPresented: $creating) {
                ProfileEditView(profile: nil)
            }
            .overlay {
                if app.profiles.isEmpty {
                    ContentUnavailableView {
                        Label("No profiles yet", systemImage: "person.crop.square")
                    } description: {
                        Text("Create a profile to start watching.")
                    }
                }
            }
        }
    }
}
