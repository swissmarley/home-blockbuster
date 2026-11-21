import SwiftUI

struct LoginView: View {
    @Environment(AppModel.self) private var app
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            LogoMark().fill(Theme.red).frame(width: 64, height: 64)
            VStack(spacing: 6) {
                Text("Sign in").font(.largeTitle.bold())
                if let server = app.current {
                    Text("\(server.name) · \(server.displayHost)")
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            SecureField("Password", text: $password)
                .textContentType(.password)
                .focused($focused)
                .submitLabel(.go)
                .onSubmit(submit)
                .padding(14)
                .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 8))
            if let error {
                Text(error).font(.subheadline).foregroundStyle(Theme.red)
            }
            Button(action: submit) {
                if busy { ProgressView().tint(.white) } else { Text("Sign In") }
            }
            .buttonStyle(PrimaryButtonStyle(fill: Theme.red, foreground: .white))
            .disabled(password.isEmpty || busy)
            Text("This server is protected with a password. This device stays signed in for 30 days.")
                .font(.footnote)
                .foregroundStyle(Theme.tertiaryText)
                .multilineTextAlignment(.center)
            Spacer()
            Button("Choose another server") { app.disconnect(keepError: false) }
                .foregroundStyle(Theme.secondaryText)
                .padding(.bottom, 12)
        }
        .padding(.horizontal, 28)
        .frame(maxWidth: 460)
        .onAppear { focused = true }
    }

    private func submit() {
        guard !password.isEmpty, !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                try await app.login(password: password)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
