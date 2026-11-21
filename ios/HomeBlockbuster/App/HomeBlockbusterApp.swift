import AVFoundation
import SwiftUI

@main
struct HomeBlockbusterApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .preferredColorScheme(.dark)
                .tint(Theme.red)
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    /// The player unlocks landscape; everything else stays portrait on iPhone.
    static var orientationLock: UIInterfaceOrientationMask = .portrait

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        return true
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        UIDevice.current.userInterfaceIdiom == .pad ? .all : Self.orientationLock
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app
    @State private var restored = false

    var body: some View {
        @Bindable var app = app
        ZStack {
            Theme.background.ignoresSafeArea()
            switch app.phase {
            case .servers:
                ServerListView()
                    .transition(.opacity)
            case .connecting:
                ConnectingView()
                    .transition(.opacity)
            case .login:
                LoginView()
                    .transition(.opacity)
            case .profiles:
                ProfilePickerView()
                    .transition(.opacity)
            case .browsing:
                MainTabView()
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: app.phase)
        .fullScreenCover(item: $app.playRequest, onDismiss: { app.playerClosed() }) { request in
            PlayerScreen(request: request)
                .environment(app)
        }
        .overlay(alignment: .bottom) {
            if let toast = app.toast {
                Text(toast)
                    .font(.subheadline)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 90)
                    .padding(.horizontal, 16)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(for: .seconds(3))
                        app.toast = nil
                    }
            }
        }
        .animation(.spring(duration: 0.3), value: app.toast)
        .task {
            guard !restored else { return }
            restored = true
            await app.restore()
        }
    }
}

struct ConnectingView: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        VStack(spacing: 20) {
            LogoMark().fill(Theme.red).frame(width: 72, height: 72)
            ProgressView().tint(.white)
            if let server = app.current {
                Text("Connecting to \(server.name)…").foregroundStyle(Theme.secondaryText)
            }
            Button("Cancel") { app.disconnect(keepError: false) }
                .foregroundStyle(Theme.secondaryText)
                .padding(.top, 12)
        }
    }
}
