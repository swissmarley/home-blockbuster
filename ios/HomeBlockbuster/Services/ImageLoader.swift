import SwiftUI
import UIKit

/// Loads server artwork with the session cookie attached, with memory + disk caching.
actor ImagePipeline {
    static let shared = ImagePipeline()

    // NSCache is thread-safe, so the synchronous cache lookup can skip the actor.
    nonisolated(unsafe) private let memory = NSCache<NSURL, UIImage>()
    private var inflight: [URL: Task<UIImage?, Never>] = [:]
    private let session: URLSession

    init() {
        memory.totalCostLimit = 120 << 20
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCache = URLCache(memoryCapacity: 0, diskCapacity: 300 << 20, diskPath: "artwork")
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 30
        config.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: config)
    }

    nonisolated func cached(_ url: URL) -> UIImage? {
        memory.object(forKey: url as NSURL)
    }

    func image(for request: URLRequest, maxPixel: CGFloat) async -> UIImage? {
        guard let url = request.url else { return nil }
        if let hit = memory.object(forKey: url as NSURL) { return hit }
        if let task = inflight[url] { return await task.value }
        let session = self.session
        let task = Task<UIImage?, Never> {
            guard let (data, response) = try? await session.data(for: request),
                  let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
            return Self.downsample(data, maxPixel: maxPixel)
        }
        inflight[url] = task
        let image = await task.value
        inflight[url] = nil
        if let image {
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            memory.setObject(image, forKey: url as NSURL, cost: cost)
        }
        return image
    }

    private static func downsample(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options) else { return UIImage(data: data) }
        let thumbOptions = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ] as CFDictionary
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions) else { return UIImage(data: data) }
        return UIImage(cgImage: cg)
    }
}

/// Artwork from the connected server. `path` is server-relative ("/api/img?…").
struct RemoteImage<Placeholder: View>: View {
    @Environment(AppModel.self) private var app
    let path: String?
    var contentMode: ContentMode = .fill
    var maxPixel: CGFloat = 900
    @ViewBuilder var placeholder: () -> Placeholder

    @State private var image: UIImage?
    @State private var loadedPath: String?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else {
                placeholder()
            }
        }
        .task(id: path) { await load() }
    }

    private func load() async {
        guard let path, let client = app.client, let url = client.url(path) else {
            image = nil
            return
        }
        if loadedPath == path, image != nil { return }
        if let hit = ImagePipeline.shared.cached(url) {
            image = hit
            loadedPath = path
            return
        }
        let loaded = await ImagePipeline.shared.image(for: client.authorizedRequest(url), maxPixel: maxPixel)
        guard !Task.isCancelled else { return }
        withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        loadedPath = path
    }
}

extension RemoteImage where Placeholder == Color {
    init(path: String?, contentMode: ContentMode = .fill, maxPixel: CGFloat = 900) {
        self.init(path: path, contentMode: contentMode, maxPixel: maxPixel) { Theme.surface }
    }
}
