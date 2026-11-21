import SwiftUI

/// Create a profile, or change a profile's settings (saved on the server, so they follow you to every device).
struct ProfileEditView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let profile: ProfileDTO?

    @State private var name = ""
    @State private var avatar = "smile-blue"
    @State private var kids = false
    @State private var autoplayNext = true
    @State private var autoplayPreviews = true
    @State private var subtitleLang: String?
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Spacer()
                        AvatarView(id: avatar).frame(width: 96, height: 96)
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 10) {
                            ForEach(AvatarView.all, id: \.self) { id in
                                Button {
                                    avatar = id
                                } label: {
                                    AvatarView(id: id)
                                        .frame(width: 54, height: 54)
                                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(.white, lineWidth: avatar == id ? 3 : 0))
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Avatar \(id)")
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    TextField("Name", text: $name)
                        .textInputAutocapitalization(.words)
                }
                Section {
                    Toggle("Kids profile", isOn: $kids)
                } footer: {
                    Text("Only shows titles rated for children.")
                }
                Section("Playback") {
                    Toggle("Autoplay next episode", isOn: $autoplayNext)
                    Toggle("Autoplay previews", isOn: $autoplayPreviews)
                    Picker("Subtitles", selection: $subtitleLang) {
                        Text("Off").tag(String?.none)
                        ForEach(Format.languages, id: \.code) { lang in
                            Text(lang.name).tag(String?.some(lang.code))
                        }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(Theme.red) }
                }
                if profile != nil && app.profiles.count > 1 {
                    Section {
                        Button("Delete Profile", role: .destructive) { confirmDelete = true }
                    } footer: {
                        Text("Deleting a profile removes its My List, ratings and watch history on this server.")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(profile == nil ? "Add Profile" : "Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() } else {
                        Button("Save", action: save).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .confirmationDialog("Delete \(profile?.name ?? "")?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete Profile", role: .destructive) {
                    guard let profile else { return }
                    Task {
                        do {
                            try await app.deleteProfile(profile.id)
                            dismiss()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard let profile else {
            avatar = AvatarView.all.filter { id in !app.profiles.contains { $0.avatar == id } }.first ?? "smile-blue"
            return
        }
        name = profile.name
        avatar = profile.avatar
        kids = profile.kids
        autoplayNext = profile.autoplayNext
        autoplayPreviews = profile.autoplayPreviews
        subtitleLang = profile.subtitleLang
    }

    private func save() {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        saving = true
        error = nil
        Task {
            defer { saving = false }
            do {
                var id = profile?.id
                if id == nil {
                    id = try await app.createProfile(name: trimmed, avatar: avatar, kids: kids).id
                }
                try await app.updateProfile(id!, .init(name: trimmed, avatar: avatar, kids: kids, autoplayNext: autoplayNext,
                                                       autoplayPreviews: autoplayPreviews, subtitleLang: subtitleLang))
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
