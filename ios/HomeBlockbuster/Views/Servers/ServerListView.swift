import SwiftUI

/// Saved Home Blockbuster instances: pick one to connect, or add a new one.
struct ServerListView: View {
    @Environment(AppModel.self) private var app
    @State private var editing: ServerConnection?
    @State private var adding = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 14) {
                        LogoMark().fill(Theme.red).frame(width: 64, height: 64)
                        Wordmark(size: 30)
                        Text("Your movies and shows, from any Home Blockbuster server.")
                            .font(.subheadline)
                            .foregroundStyle(Theme.secondaryText)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 36)

                    if let error = app.connectError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.white)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.red.opacity(0.22), in: RoundedRectangle(cornerRadius: 10))
                    }

                    if app.servers.isEmpty {
                        emptyState
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Your servers")
                                .font(.headline)
                                .foregroundStyle(Theme.secondaryText)
                            ForEach(app.sortedServers) { server in
                                ServerRow(server: server) {
                                    Task { await app.connect(server) }
                                } onEdit: {
                                    editing = server
                                }
                            }
                        }
                        Button {
                            adding = true
                        } label: {
                            Label("Add Server", systemImage: "plus")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .background(Theme.background)
            .sheet(isPresented: $adding) {
                ServerEditView(server: nil)
            }
            .sheet(item: $editing) { server in
                ServerEditView(server: server)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "server.rack")
                .font(.system(size: 42))
                .foregroundStyle(Theme.secondaryText)
            Text("Add your first server")
                .font(.title3.bold())
            Text("Enter the address of a Home Blockbuster server, for example 192.168.1.20:8585 at home. You can save as many servers as you like — at home, at a friend's place — and switch between them any time.")
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
            Button {
                adding = true
            } label: {
                Label("Add Server", systemImage: "plus")
            }
            .buttonStyle(PrimaryButtonStyle(fill: Theme.red, foreground: .white))
            .padding(.top, 4)
        }
        .padding(24)
        .background(Theme.surface.opacity(0.6), in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct ServerRow: View {
    let server: ServerConnection
    var onConnect: () -> Void
    var onEdit: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Button(action: onConnect) {
                HStack(spacing: 14) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10).fill(Theme.surfaceHigh)
                        Image(systemName: icon).font(.system(size: 20, weight: .semibold))
                    }
                    .frame(width: 46, height: 46)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(server.name).font(.headline).foregroundStyle(.white)
                        Text(server.displayHost).font(.subheadline).foregroundStyle(Theme.secondaryText)
                        if let used = server.lastUsedAt {
                            Text("Last used \(used.formatted(.relative(presentation: .named)))")
                                .font(.caption)
                                .foregroundStyle(Theme.tertiaryText)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Connects to this server")

            Button(action: onEdit) {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 22))
                    .foregroundStyle(Theme.secondaryText)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Edit \(server.name)")
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
    }

    private var icon: String {
        let name = server.name.lowercased()
        if name.contains("home") || name.contains("casa") || name.contains("zuhause") { return "house.fill" }
        if server.url.hasPrefix("https") { return "lock.shield.fill" }
        return "server.rack"
    }
}

/// Add or edit a saved server.
struct ServerEditView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let server: ServerConnection?

    @State private var name = ""
    @State private var address = ""
    @State private var rememberProfile = false
    @State private var checking = false
    @State private var error: String?
    @State private var confirmDelete = false
    @FocusState private var focus: Field?
    private enum Field { case name, address }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Address", text: $address, prompt: Text("192.168.1.20:8585"))
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focus, equals: .address)
                        .submitLabel(.next)
                        .onSubmit { focus = .name }
                    TextField("Name", text: $name, prompt: Text("Home"))
                        .focused($focus, equals: .name)
                        .submitLabel(.done)
                        .onSubmit(save)
                } header: {
                    Text("Server")
                } footer: {
                    Text("The address you open Home Blockbuster with in a browser, like 192.168.1.20:8585 or nas.local:8585. If you leave out the port, 8585 is used.")
                }
                Section {
                    Toggle("Open last profile automatically", isOn: $rememberProfile)
                } footer: {
                    Text("Skips “Who's watching?” on this server.")
                }
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.red)
                    }
                }
                if server != nil {
                    Section {
                        Button("Remove Server", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle(server == nil ? "Add Server" : "Edit Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if checking {
                        ProgressView()
                    } else {
                        Button("Save", action: save).disabled(address.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .confirmationDialog("Remove \(server?.name ?? "server")?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Remove", role: .destructive) {
                    if let server { app.deleteServer(server) }
                    dismiss()
                }
            } message: {
                Text("You'll need to sign in again if you add it back.")
            }
            .onAppear {
                if let server {
                    name = server.name
                    address = server.url
                    rememberProfile = server.rememberProfile
                } else {
                    focus = .address
                }
            }
        }
        .presentationDetents([.large])
    }

    private func save() {
        guard let url = ServerConnection.normalize(address) else {
            error = "That doesn't look like a valid address."
            return
        }
        checking = true
        error = nil
        Task {
            defer { checking = false }
            do {
                let health = try await AppModel.probe(url: url)
                let host = URL(string: url)?.host() ?? url
                var saved = server ?? ServerConnection(name: "", url: url)
                saved.name = name.trimmingCharacters(in: .whitespaces).isEmpty ? (app.servers.isEmpty ? "Home" : host) : name.trimmingCharacters(in: .whitespaces)
                saved.url = url
                saved.rememberProfile = rememberProfile
                saved.version = health.version
                app.saveServer(saved)
                dismiss()
                if server == nil { await app.connect(saved) }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
