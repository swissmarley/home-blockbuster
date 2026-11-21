import AVFoundation
import AVKit
import SwiftUI

struct PlayerScreen: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let request: PlayRequest

    @State private var controller: PlayerController
    @State private var controlsVisible = true
    @State private var hideTask: Task<Void, Never>?
    @State private var scrubbing = false
    @State private var scrubValue: Double = 0
    @State private var fill = false

    init(request: PlayRequest) {
        self.request = request
        _controller = State(initialValue: PlayerController(fileId: request.fileId))
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VideoSurface(player: controller.player, fill: fill)
                .ignoresSafeArea()
                .accessibilityHidden(true)

            if let text = controller.cueText {
                SubtitleText(text: text, scale: app.preferences.subtitleSize)
                    .padding(.bottom, controlsVisible ? 110 : 34)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .allowsHitTesting(false)
                    .animation(.easeOut(duration: 0.2), value: controlsVisible)
            }

            // Tap target for showing / hiding the controls.
            Color.clear
                .contentShape(Rectangle())
                .ignoresSafeArea()
                .onTapGesture { toggleControls() }
                .onTapGesture(count: 2) { withAnimation { fill.toggle() } }

            if controller.loading || controller.buffering {
                ProgressView().tint(.white).scaleEffect(1.6).allowsHitTesting(false)
            }

            if controlsVisible && controller.error == nil {
                controls.transition(.opacity)
            }

            if let error = controller.error {
                errorView(error)
            }

            if let countdown = controller.countdown, let next = controller.next {
                nextCountdown(countdown, next)
            }
        }
        .statusBarHidden(!controlsVisible)
        .persistentSystemOverlays(.hidden)
        .task {
            await controller.start(app: app, fromStart: request.fromStart)
            scheduleHide()
        }
        .onAppear { setLandscape(true) }
        .onDisappear {
            controller.stop()
            setLandscape(false)
        }
        .onChange(of: controller.isPlaying) { _, playing in
            if playing { scheduleHide() } else { show() }
        }
    }

    // MARK: Controls

    private var controls: some View {
        ZStack {
            LinearGradient(colors: [.black.opacity(0.75), .clear, .clear, .black.opacity(0.8)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            VStack {
                topBar
                Spacer()
                bottomBar
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)

            HStack(spacing: 60) {
                Button { controller.skip(-10); scheduleHide() } label: {
                    Image(systemName: "gobackward.10").font(.system(size: 34, weight: .medium))
                }
                .accessibilityLabel("Back 10 seconds")
                Button { controller.togglePlay(); scheduleHide() } label: {
                    Image(systemName: controller.isPlaying ? "pause.fill" : "play.fill").font(.system(size: 52))
                        .frame(width: 70, height: 70)
                }
                .accessibilityLabel(controller.isPlaying ? "Pause" : "Play")
                Button { controller.skip(10); scheduleHide() } label: {
                    Image(systemName: "goforward.10").font(.system(size: 34, weight: .medium))
                }
                .accessibilityLabel("Forward 10 seconds")
            }
            .opacity(controller.loading ? 0 : 1)
        }
        .foregroundStyle(.white)
    }

    private var topBar: some View {
        HStack(spacing: 18) {
            Button { close() } label: {
                Image(systemName: "xmark").font(.system(size: 20, weight: .semibold)).frame(width: 44, height: 44)
            }
            .accessibilityLabel("Close player")
            VStack(alignment: .leading, spacing: 2) {
                Text(controller.title?.name ?? "").font(.headline).lineLimit(1)
                if let ep = controller.episode, controller.title?.kind == .show || (controller.title?.episodeCount ?? 0) > 1 {
                    Text("\(ep.code) “\(ep.name)”").font(.subheadline).foregroundStyle(Theme.secondaryText).lineLimit(1)
                }
            }
            Spacer()
            RoutePicker().frame(width: 36, height: 36)
            optionsMenu
        }
    }

    private var optionsMenu: some View {
        Menu {
            if let info = controller.info {
                Section("Subtitles") {
                    Button { controller.selectSubtitle(nil) } label: {
                        checkmarkLabel("Off", controller.subtitle == nil)
                    }
                    ForEach(info.subtitles) { track in
                        Button { controller.selectSubtitle(track) } label: {
                            checkmarkLabel(track.label, controller.subtitle?.id == track.id)
                        }
                    }
                }
                if info.audioTracks.count > 1 {
                    Section("Audio") {
                        ForEach(info.audioTracks) { track in
                            Button { controller.selectAudio(track.index) } label: {
                                checkmarkLabel(track.label, controller.audioIndex == track.index)
                            }
                        }
                    }
                }
            }
            Section("Speed") {
                ForEach([0.5, 0.75, 1.0, 1.25, 1.5], id: \.self) { r in
                    Button { controller.setRate(Float(r)) } label: {
                        checkmarkLabel(r == 1 ? "1× (Normal)" : "\(r.formatted())×", controller.rate == Float(r))
                    }
                }
            }
            Section {
                Button { withAnimation { fill.toggle() } } label: {
                    Label(fill ? "Fit to Screen" : "Fill Screen", systemImage: fill ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                }
            }
        } label: {
            Image(systemName: "captions.bubble").font(.system(size: 20, weight: .semibold)).frame(width: 44, height: 44)
        }
        .accessibilityLabel("Audio, subtitles and speed")
        .onTapGesture { show() }
    }

    @ViewBuilder
    private func checkmarkLabel(_ title: String, _ on: Bool) -> some View {
        if on { Label(title, systemImage: "checkmark") } else { Text(title) }
    }

    private var bottomBar: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Text(Format.clock(scrubbing ? scrubValue : controller.position))
                    .font(.caption.monospacedDigit())
                Slider(value: Binding(get: { scrubbing ? scrubValue : controller.position }, set: { scrubValue = $0 }),
                       in: 0...max(1, controller.duration)) { editing in
                    if editing {
                        scrubbing = true
                        scrubValue = controller.position
                        hideTask?.cancel()
                    } else {
                        controller.seek(to: scrubValue)
                        scrubbing = false
                        scheduleHide()
                    }
                }
                .tint(Theme.red)
                .disabled(controller.duration <= 0)
                Text("-" + Format.clock(max(0, controller.duration - (scrubbing ? scrubValue : controller.position))))
                    .font(.caption.monospacedDigit())
            }
            HStack {
                if controller.isStreamed {
                    Label(controller.info?.mode == .transcode ? "Converted by server" : "Optimized by server", systemImage: "bolt.horizontal.circle")
                        .font(.caption2)
                        .foregroundStyle(Theme.secondaryText)
                }
                Spacer()
                if controller.next != nil {
                    Button {
                        Task { await controller.playNext() }
                    } label: {
                        Label("Next Episode", systemImage: "forward.end.fill").font(.subheadline.weight(.semibold))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(controller.showsNextButton ? Color.white : Color.white.opacity(0.15), in: RoundedRectangle(cornerRadius: 4))
                    .foregroundStyle(controller.showsNextButton ? .black : .white)
                }
            }
        }
    }

    private func errorView(_ error: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundStyle(Theme.red)
            Text("Playback problem").font(.title3.bold())
            Text(error).font(.subheadline).foregroundStyle(Theme.secondaryText).multilineTextAlignment(.center)
            HStack(spacing: 12) {
                Button("Close") { close() }.buttonStyle(SecondaryButtonStyle()).frame(width: 130)
                Button("Try Again") { controller.retry() }.buttonStyle(PrimaryButtonStyle()).frame(width: 130)
            }
        }
        .padding(30)
        .frame(maxWidth: 480)
        .background(.black.opacity(0.8), in: RoundedRectangle(cornerRadius: 16))
    }

    private func nextCountdown(_ seconds: Int, _ next: EpisodeDTO) -> some View {
        VStack(alignment: .trailing, spacing: 10) {
            Text("Next: \(next.code) “\(next.name)”").font(.subheadline.weight(.semibold))
            HStack(spacing: 10) {
                Button("Cancel") { controller.cancelCountdown() }
                    .buttonStyle(SecondaryButtonStyle()).frame(width: 110)
                Button {
                    Task { await controller.playNext() }
                } label: {
                    Label("Play in \(seconds)", systemImage: "play.fill")
                }
                .buttonStyle(PrimaryButtonStyle()).frame(width: 150)
            }
        }
        .padding(20)
        .background(.black.opacity(0.75), in: RoundedRectangle(cornerRadius: 12))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .padding(24)
    }

    // MARK: Behaviour

    private func toggleControls() {
        if controlsVisible {
            withAnimation(.easeOut(duration: 0.2)) { controlsVisible = false }
        } else {
            show()
        }
    }

    private func show() {
        withAnimation(.easeOut(duration: 0.2)) { controlsVisible = true }
        scheduleHide()
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled, controller.isPlaying, !scrubbing else { return }
            withAnimation(.easeOut(duration: 0.3)) { controlsVisible = false }
        }
    }

    private func close() {
        dismiss()
    }

    private static func requestRotation(_ scene: UIWindowScene, _ mask: UIInterfaceOrientationMask, attempts: Int) {
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in
            guard attempts > 1, AppDelegate.orientationLock.contains(mask == .portrait ? .portrait : .landscapeLeft) else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                requestRotation(scene, mask, attempts: attempts - 1)
            }
        }
    }

    private func setLandscape(_ on: Bool) {
        AppDelegate.orientationLock = on ? .allButUpsideDown : .portrait
        guard UIDevice.current.userInterfaceIdiom == .phone,
              let scene = UIApplication.shared.connectedScenes.first(where: { $0 is UIWindowScene }) as? UIWindowScene else { return }
        // Let every controller in the chain re-read the allowed orientations, then rotate.
        var vc = scene.keyWindow?.rootViewController
        while let current = vc {
            current.setNeedsUpdateOfSupportedInterfaceOrientations()
            vc = current.presentedViewController
        }
        // UIKit picks up the new supported orientations after the presentation animation; retry until it has.
        Self.requestRotation(scene, on ? .landscape : .portrait, attempts: 8)
    }
}

private struct SubtitleText: View {
    let text: String
    let scale: Double
    var body: some View {
        Text(clean(text))
            .font(.system(size: 20 * scale, weight: .semibold))
            .multilineTextAlignment(.center)
            .foregroundStyle(.white)
            .shadow(color: .black, radius: 2, x: 0, y: 1)
            .shadow(color: .black.opacity(0.8), radius: 5)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 4))
            .padding(.horizontal, 40)
    }

    /// Cues may carry simple markup (<i>, <b>, {\an8}).
    private func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "\\{[^}]*\\}", with: "", options: .regularExpression)
    }
}

/// AVPlayerLayer host.
struct VideoSurface: UIViewRepresentable {
    let player: AVPlayer
    var fill: Bool

    final class LayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }

    func makeUIView(context: Context) -> LayerView {
        let view = LayerView()
        view.backgroundColor = .black
        view.playerLayer.player = player
        return view
    }

    func updateUIView(_ view: LayerView, context: Context) {
        view.playerLayer.videoGravity = fill ? .resizeAspectFill : .resizeAspect
    }
}

/// AirPlay button.
struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = UIColor(Theme.red)
        view.prioritizesVideoDevices = true
        return view
    }
    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
