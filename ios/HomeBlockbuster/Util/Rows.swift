import Foundation

/// Home-screen rows, ported from web/src/lib/rows.ts so both clients feel the same.
struct RowDef: Identifiable, Hashable {
    enum Style: Hashable { case standard, top10, continueWatching }
    var id: String
    var title: String
    var style: Style
    var items: [TitleSummary]
    var continueItems: [ContinueItem] = []
}

enum BrowseFilter: String, CaseIterable, Identifiable {
    case all, show, movie
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: "Home"
        case .show: "TV Shows"
        case .movie: "Movies"
        }
    }
}

enum Rows {
    private static let rowLimit = 40

    private static let genreNames: [String: (String, String, String)] = [
        "action": ("Action & Adventure", "Action Movies", "Action TV"),
        "action & adventure": ("Action & Adventure", "Action & Adventure Movies", "Action & Adventure TV"),
        "adventure": ("Adventures", "Adventure Movies", "Adventure TV"),
        "animation": ("Animation", "Animated Movies", "Animated TV"),
        "anime": ("Anime", "Anime Movies", "Anime Series"),
        "comedy": ("Comedies", "Comedy Movies", "TV Comedies"),
        "crime": ("Crime", "Crime Movies", "Crime TV Shows"),
        "documentary": ("Documentaries", "Documentary Films", "Docuseries"),
        "drama": ("Dramas", "Drama Movies", "TV Dramas"),
        "family": ("Family Time", "Family Movies", "Family TV"),
        "fantasy": ("Fantasy", "Fantasy Movies", "Fantasy TV"),
        "history": ("History", "Historical Movies", "Historical TV"),
        "horror": ("Horror", "Horror Movies", "Horror TV Shows"),
        "kids": ("Kids", "Kids Movies", "Kids TV"),
        "music": ("Music & Musicals", "Music & Musicals", "Music TV"),
        "mystery": ("Mysteries", "Mystery Movies", "Mystery TV"),
        "romance": ("Romance", "Romantic Movies", "Romantic TV Shows"),
        "science fiction": ("Sci-Fi", "Sci-Fi Movies", "Sci-Fi TV"),
        "sci-fi & fantasy": ("Sci-Fi & Fantasy", "Sci-Fi & Fantasy Movies", "Sci-Fi & Fantasy TV"),
        "thriller": ("Thrillers", "Thriller Movies", "TV Thrillers"),
        "war": ("War", "War Movies", "War TV"),
        "war & politics": ("War & Politics", "War Movies", "War & Politics TV"),
        "western": ("Westerns", "Westerns", "Western TV"),
        "reality": ("Reality TV", "Reality", "Reality TV"),
        "tv movie": ("TV Movies", "TV Movies", "TV Movies"),
    ]

    static func genreTitle(_ genre: String, _ filter: BrowseFilter) -> String {
        guard let names = genreNames[genre.lowercased()] else { return genre }
        switch filter {
        case .all: return names.0
        case .movie: return names.1
        case .show: return names.2
        }
    }

    static func trendScore(_ t: TitleSummary) -> Double {
        (t.rating ?? 5) * 2 + log10(1 + (t.popularity ?? 0)) * 3
    }

    private static func hash(_ s: String) -> UInt32 {
        var h: UInt32 = 2_166_136_261
        for u in s.utf16 { h = (h ^ UInt32(u)) &* 16_777_619 }
        return h
    }

    private static var today: String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    private static func dailyShuffle(_ items: [TitleSummary]) -> [TitleSummary] {
        let day = today
        return items.sorted { hash($0.id + day) < hash($1.id + day) }
    }

    private static func overlap(_ a: TitleSummary, _ b: TitleSummary) -> Int {
        a.genres.filter(b.genres.contains).count * 2 + a.tags.filter(b.tags.contains).count
    }

    private static func isRated(_ t: TitleSummary) -> Bool {
        (t.rating ?? 0) > 0 || (t.popularity ?? 0) > 0
    }

    static func build(titles all: [TitleSummary], titleMap: [String: TitleSummary], state: ProfileState?, continueItems allContinue: [ContinueItem], profileName: String, filter: BrowseFilter) -> [RowDef] {
        let titles = all.filter { filter == .all || $0.kind.rawValue == filter.rawValue }
        let inScope: (TitleSummary?) -> Bool = { t in
            guard let t else { return false }
            return filter == .all || t.kind.rawValue == filter.rawValue
        }
        var rows: [RowDef] = []
        func add(_ row: RowDef, min: Int = 1) {
            var r = row
            r.items = Array(row.items.prefix(row.style == .top10 ? 10 : rowLimit))
            if r.items.count >= min { rows.append(r) }
        }

        let continueItems = allContinue.filter { inScope(titleMap[$0.titleId]) }
        if !continueItems.isEmpty {
            rows.append(RowDef(id: "continue", title: "Continue Watching for \(profileName)", style: .continueWatching,
                               items: continueItems.compactMap { titleMap[$0.titleId] }, continueItems: continueItems))
        }
        if let state, !state.myList.isEmpty {
            add(RowDef(id: "mylist", title: "My List", style: .standard, items: state.myList.compactMap { titleMap[$0] }.filter { inScope($0) }))
        }

        let byAdded = titles.sorted { $0.addedAt > $1.addedAt }
        let recent = byAdded.filter { Format.isRecentlyAdded($0.addedAt, days: 30) }
        add(RowDef(id: "new", title: "New on Home Blockbuster", style: .standard, items: recent.count >= 4 ? recent : byAdded))

        let top: ([TitleSummary]) -> [TitleSummary] = { $0.sorted { trendScore($0) > trendScore($1) } }
        let movies = titles.filter { $0.kind == .movie && isRated($0) }
        let shows = titles.filter { $0.kind == .show && isRated($0) }
        if filter != .show && movies.count >= 10 {
            add(RowDef(id: "top-movies", title: "Top 10 Movies in Your Library Today", style: .top10, items: top(movies)), min: 10)
        }
        let rated = titles.filter(isRated)
        add(RowDef(id: "trending", title: "Trending Now", style: .standard, items: dailyShuffle(Array(top(rated).prefix(30)))), min: 4)

        if let last = allContinue.first, let anchor = titleMap[last.titleId] {
            let scored: [(TitleSummary, Int)] = titles.filter { $0.id != anchor.id }.map { ($0, overlap(anchor, $0)) }.filter { $0.1 > 0 }
            let similar: [TitleSummary] = scored.sorted { (a: (TitleSummary, Int), b: (TitleSummary, Int)) -> Bool in
                if a.1 != b.1 { return a.1 > b.1 }
                return (a.0.rating ?? 0) > (b.0.rating ?? 0)
            }.map { $0.0 }
            add(RowDef(id: "because", title: "Because You Watched \(anchor.name)", style: .standard, items: similar), min: 3)
        }
        if filter != .movie && shows.count >= 10 {
            add(RowDef(id: "top-shows", title: "Top 10 TV Shows in Your Library Today", style: .top10, items: top(shows)), min: 10)
        }

        var genreCounts: [String: Int] = [:]
        for t in titles { for g in t.genres { genreCounts[g, default: 0] += 1 } }
        let common: [(key: String, value: Int)] = genreCounts.filter { $0.value >= 2 }.map { (key: $0.key, value: $0.value) }
        let sortedGenres = common.sorted { (a: (key: String, value: Int), b: (key: String, value: Int)) -> Bool in
            a.value != b.value ? a.value > b.value : a.key < b.key
        }
        let genres: [String] = sortedGenres.prefix(12).map { $0.key }
        let genreRows = genres.map { g in
            RowDef(id: "genre-\(g)", title: genreTitle(g, filter), style: .standard, items: dailyShuffle(titles.filter { $0.genres.contains(g) }))
        }

        let acclaimed = titles.filter { ($0.rating ?? 0) >= 7.5 }.sorted { ($0.rating ?? 0) > ($1.rating ?? 0) }
        var watchedIds: [String] = []
        for p in (state?.progress.values.map { $0 } ?? []).sorted(by: { $0.updatedAt > $1.updatedAt }) where p.finished && !watchedIds.contains(p.titleId) {
            watchedIds.append(p.titleId)
        }
        let watchAgain = watchedIds.compactMap { titleMap[$0] }.filter { inScope($0) }
        var curated = [
            RowDef(id: "acclaimed", title: "Critically Acclaimed", style: .standard, items: acclaimed),
            RowDef(id: "again", title: "Watch It Again", style: .standard, items: watchAgain),
        ]
        var decades: [Int: [TitleSummary]] = [:]
        for t in titles {
            guard let y = t.year else { continue }
            let d = y / 10 * 10
            if d >= 1950 && d <= 2000 { decades[d, default: []].append(t) }
        }
        for (d, list) in decades.sorted(by: { $0.key > $1.key }) where list.count >= 4 {
            curated.append(RowDef(id: "decade-\(d)", title: "\(String(String(d).suffix(2)))s \(filter == .show ? "TV" : "Favorites")", style: .standard, items: list))
        }
        var mixed: [RowDef] = []
        for i in 0..<max(genreRows.count, curated.count) {
            if i * 2 < genreRows.count { mixed.append(genreRows[i * 2]) }
            if i * 2 + 1 < genreRows.count { mixed.append(genreRows[i * 2 + 1]) }
            if i < curated.count { mixed.append(curated[i]) }
        }
        for row in mixed { add(row, min: row.id.hasPrefix("genre") ? 2 : 3) }

        let alpha: ([TitleSummary]) -> [TitleSummary] = { $0.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending } }
        if filter == .all {
            add(RowDef(id: "all-shows", title: "TV Shows", style: .standard, items: alpha(titles.filter { $0.kind == .show })))
            add(RowDef(id: "all-movies", title: "Movies", style: .standard, items: alpha(titles.filter { $0.kind == .movie })))
        } else {
            add(RowDef(id: "all", title: filter == .show ? "All TV Shows" : "All Movies", style: .standard, items: alpha(titles)))
        }

        var seen = Set<String>()
        return rows.filter { row in
            if row.style == .continueWatching { return true }
            let sig = row.items.map(\.id).sorted().joined(separator: ",")
            return seen.insert(sig).inserted
        }
    }

    static func billboard(_ titles: [TitleSummary], seed: String) -> TitleSummary? {
        let withArt = titles.filter { $0.images.backdrop != nil || $0.images.thumb != nil || $0.images.poster != nil }
        let pool = withArt.isEmpty ? titles : withArt
        guard !pool.isEmpty else { return nil }
        func score(_ t: TitleSummary) -> Double {
            trendScore(t) + (Format.isRecentlyAdded(t.addedAt, days: 21) ? 4 : 0) + (t.images.logo != nil ? 2 : 0) + (t.images.backdrop != nil ? 3 : 0)
        }
        let ranked = pool.sorted { score($0) > score($1) }
        let top = Array(ranked.prefix(8))
        return top[Int(hash(seed) % UInt32(top.count))]
    }

    static func search(_ titles: [TitleSummary], _ query: String) -> [TitleSummary] {
        func norm(_ s: String) -> String {
            let folded = s.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
            let mapped = folded.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : " " }
            return String(mapped).split(separator: " ").joined(separator: " ")
        }
        let q = norm(query)
        guard !q.isEmpty else { return [] }
        let tokens = q.split(separator: " ").map(String.init)
        func has(_ hay: String, _ token: String) -> Bool {
            token.count > 1 ? hay.contains(token) : hay.split(separator: " ").contains { $0.hasPrefix(token) }
        }
        var scored: [(TitleSummary, Double)] = []
        for t in titles {
            let name = norm(t.name)
            let people = t.people.map(norm)
            let genres = (t.genres + t.tags).map(norm)
            let overview = norm(t.overview)
            var score = 0.0
            if name == q { score += 100 } else if name.hasPrefix(q) { score += 60 } else if name.contains(q) { score += 40 }
            for token in tokens {
                if name.split(separator: " ").contains(where: { $0.hasPrefix(token) }) { score += 10 }
                if people.contains(where: { $0.split(separator: " ").contains { $0.hasPrefix(token) } }) { score += 8 }
                if genres.contains(where: { has($0, token) }) { score += 6 }
                if token.count > 2 && overview.contains(token) { score += 2 }
            }
            if people.contains(q) { score += 30 }
            let allMatch = tokens.allSatisfy { tok in
                has(name, tok) || people.contains { has($0, tok) } || genres.contains { has($0, tok) } || has(overview, tok)
            }
            if score > 0 && allMatch { scored.append((t, score + trendScore(t) / 10)) }
        }
        return scored.sorted { $0.1 > $1.1 }.map(\.0)
    }
}
