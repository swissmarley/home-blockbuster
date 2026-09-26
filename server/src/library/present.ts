import { imageUrl } from '../media/images.js';
import { previewUrl } from '../media/playback.js';
import type {
  EpisodeDTO,
  FileDTO,
  Quality,
  SeasonDTO,
  SubtitleTrack,
  TitleDetail,
  TitleSummary,
} from '../shared/types.js';
import type { StoredFile, StoredSubtitle, StoredTitle } from '../types.js';

export interface PresentContext {
  /** Library ids that are currently reachable. */
  onlineLibraries: Set<string>;
  ffmpeg: boolean;
}

export const episodeKey = (season: number, episode: number): string => `S${season}E${episode}`;

/** Season / episode numbers of an episode file (date-based episodes are numbered by air date). */
export function episodeNumbers(file: StoredFile): { season: number; episode: number } {
  const p = file.parsed;
  const tagSeason = file.tags?.season;
  const season = p.season ?? tagSeason ?? (p.airDate ? Number(p.airDate.slice(0, 4)) : 1);
  const episode = p.episode ?? file.tags?.episode ?? (p.airDate ? Number(p.airDate.slice(5, 7) + p.airDate.slice(8, 10)) : 0);
  return { season, episode };
}

/** Episodes in viewing order: regular seasons first, specials (season 0) last. */
export function sortEpisodes(files: StoredFile[]): StoredFile[] {
  return [...files].sort((a, b) => {
    const ea = episodeNumbers(a);
    const eb = episodeNumbers(b);
    const sa = ea.season === 0 ? Number.MAX_SAFE_INTEGER : ea.season;
    const sb = eb.season === 0 ? Number.MAX_SAFE_INTEGER : eb.season;
    return sa - sb || ea.episode - eb.episode || (a.parsed.part ?? 0) - (b.parsed.part ?? 0) || a.relPath.localeCompare(b.relPath);
  });
}

/** Best version of a movie: highest resolution, then first part, then largest. */
export function bestMovieFile(files: StoredFile[], online?: Set<string>): StoredFile | null {
  const pool = online ? files.filter((f) => online.has(f.libraryId)) : files;
  const candidates = pool.length ? pool : files;
  return (
    [...candidates].sort((a, b) => {
      const pa = a.parsed.part ?? 1;
      const pb = b.parsed.part ?? 1;
      if (pa !== pb) return pa - pb;
      const ha = a.probe?.video?.height ?? 0;
      const hb = b.probe?.video?.height ?? 0;
      return hb - ha || b.size - a.size;
    })[0] ?? null
  );
}

export function playFileFor(title: StoredTitle, files: StoredFile[], online?: Set<string>): StoredFile | null {
  if (title.kind === 'movie') return bestMovieFile(files, online);
  const ordered = sortEpisodes(files);
  const pool = online ? ordered.filter((f) => online.has(f.libraryId)) : ordered;
  return pool[0] ?? ordered[0] ?? null;
}

export function nextEpisodeFile(files: StoredFile[], currentId: string): StoredFile | null {
  const ordered = sortEpisodes(files);
  const index = ordered.findIndex((f) => f.id === currentId);
  if (index < 0) return null;
  const current = episodeNumbers(ordered[index]!);
  // Skip other parts / duplicate versions of the same episode.
  for (let i = index + 1; i < ordered.length; i++) {
    const n = episodeNumbers(ordered[i]!);
    if (n.season !== current.season || n.episode !== current.episode) return ordered[i]!;
  }
  return null;
}

function qualityOf(files: StoredFile[]): Quality | null {
  let best: Quality | null = null;
  const rank = { SD: 1, HD: 2, '4K': 3 } as const;
  for (const f of files) {
    const v = f.probe?.video;
    let q: Quality | null = null;
    if (v && (v.width || v.height)) q = v.width >= 3200 || v.height >= 2000 ? '4K' : v.width >= 1200 || v.height >= 700 ? 'HD' : 'SD';
    else if (f.parsed.resolution) q = f.parsed.resolution === '2160p' ? '4K' : /1080|720/.test(f.parsed.resolution) ? 'HD' : 'SD';
    if (q && (!best || rank[q] > rank[best])) best = q;
  }
  return best;
}

export function subtitleTracks(subs: StoredSubtitle[]): SubtitleTrack[] {
  return subs.map((s) => ({ id: s.id, label: s.label, language: s.language, forced: s.forced, source: s.source }));
}

function fileDTO(f: StoredFile): FileDTO {
  return {
    id: f.id,
    path: f.path,
    size: f.size,
    container: f.ext,
    duration: f.probe?.duration ?? null,
    width: f.probe?.video?.width || null,
    height: f.probe?.video?.height || null,
    videoCodec: f.probe?.video?.codec ?? null,
    audioCodecs: f.probe?.audio.map((a) => a.codec) ?? [],
    subtitles: subtitleTracks(f.subtitles),
    libraryId: f.libraryId,
  };
}

export function episodeDTO(title: StoredTitle, file: StoredFile): EpisodeDTO {
  const { season, episode } = episodeNumbers(file);
  const meta = title.episodes[episodeKey(season, episode)];
  const fallbackName = file.parsed.episodeTitle ?? (file.tags?.title && file.tags.title !== title.name ? file.tags.title : null);
  return {
    id: file.id,
    fileId: file.id,
    season,
    episode,
    episodeEnd: file.parsed.episodeEnd,
    name: meta?.name || fallbackName || (episode ? `Episode ${episode}` : file.parsed.airDate ?? 'Episode'),
    overview: meta ? meta.overview : file.tags?.description ?? '',
    still: imageUrl(meta?.still ?? file.thumb),
    runtime: meta?.runtime ?? (file.probe?.duration ? Math.round(file.probe.duration / 60) : null),
    airDate: meta?.airDate ?? file.parsed.airDate,
    duration: file.probe?.duration ?? null,
  };
}

export function seasonsOf(title: StoredTitle, files: StoredFile[]): SeasonDTO[] {
  const bySeason = new Map<number, EpisodeDTO[]>();
  const seen = new Set<string>();
  for (const f of sortEpisodes(files)) {
    const ep = episodeDTO(title, f);
    const key = episodeKey(ep.season, ep.episode);
    if (seen.has(key) && ep.episode !== 0) continue; // extra versions/parts of the same episode
    seen.add(key);
    const list = bySeason.get(ep.season) ?? [];
    list.push(ep);
    bySeason.set(ep.season, list);
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
    .map(([number, episodes]) => {
      const meta = title.seasons[String(number)];
      return {
        number,
        name: meta?.name || (number === 0 ? 'Specials' : `Season ${number}`),
        overview: meta?.overview ?? '',
        poster: imageUrl(meta?.poster),
        episodes,
      };
    });
}

export function titleSummary(title: StoredTitle, files: StoredFile[], ctx: PresentContext): TitleSummary {
  const play = playFileFor(title, files, ctx.onlineLibraries);
  const withThumb = play?.thumb ? play : files.find((f) => f.thumb);
  const cover = files.find((f) => f.cover)?.cover ?? null;
  const seasons = new Set<number>();
  const episodes = new Set<string>();
  if (title.kind === 'show') {
    for (const f of files) {
      const { season, episode } = episodeNumbers(f);
      if (season > 0) seasons.add(season);
      episodes.add(episodeKey(season, episode));
    }
  }
  const people = [...title.cast.slice(0, 6).map((c) => c.name), ...title.directors, ...title.creators];
  const durationMinutes = play?.probe?.duration ? Math.round(play.probe.duration / 60) : null;
  return {
    id: title.id,
    kind: title.kind,
    name: title.name,
    year: title.year,
    overview: title.overview,
    genres: title.genres,
    tags: title.tags,
    rating: title.rating,
    popularity: title.popularity,
    maturity: title.maturity,
    runtime: title.runtime ?? durationMinutes,
    seasonCount: title.kind === 'show' ? Math.max(seasons.size, episodes.size ? 1 : 0) : 0,
    episodeCount: episodes.size,
    quality: qualityOf(files),
    images: {
      poster: imageUrl(title.images.poster ?? cover),
      backdrop: imageUrl(title.images.backdrop),
      card: imageUrl(title.images.card),
      cardHasTitle: Boolean(title.images.card && title.images.cardHasTitle),
      logo: imageUrl(title.images.logo),
      thumb: imageUrl(withThumb?.thumb),
    },
    addedAt: title.addedAt,
    releaseDate: title.releaseDate,
    people: [...new Set(people)],
    libraryIds: [...new Set(files.map((f) => f.libraryId))],
    playFileId: play?.id ?? null,
    previewUrl: previewUrl(play ?? undefined, ctx.ffmpeg),
    source: title.metadata.source,
    available: files.some((f) => ctx.onlineLibraries.has(f.libraryId)),
  };
}

/** Similar titles ranked by genre/tag overlap. */
export function similarTitles(title: StoredTitle, all: StoredTitle[], limit = 12): string[] {
  const genres = new Set(title.genres);
  const tags = new Set(title.tags);
  const people = new Set([...title.directors, ...title.cast.slice(0, 5).map((c) => c.name)]);
  const scored: Array<{ id: string; score: number }> = [];
  for (const other of all) {
    if (other.id === title.id) continue;
    let score = 0;
    for (const g of other.genres) if (genres.has(g)) score += 2;
    for (const t of other.tags) if (tags.has(t)) score += 1;
    for (const p of [...other.directors, ...other.cast.slice(0, 5).map((c) => c.name)]) if (people.has(p)) score += 1.5;
    if (other.kind === title.kind) score += 0.5;
    if (score > 0.5) scored.push({ id: other.id, score: score + (other.rating ?? 0) / 20 });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.id);
}

export function titleDetail(title: StoredTitle, files: StoredFile[], all: StoredTitle[], ctx: PresentContext): TitleDetail {
  return {
    ...titleSummary(title, files, ctx),
    tagline: title.tagline,
    cast: title.cast.map((c) => ({ ...c, photo: imageUrl(c.photo) })),
    directors: title.directors,
    writers: title.writers,
    creators: title.creators,
    studios: title.studios,
    seasons: title.kind === 'show' ? seasonsOf(title, files) : [],
    files: (title.kind === 'show' ? sortEpisodes(files) : files).map(fileDTO),
    externalIds: title.externalIds,
    similar: similarTitles(title, all),
    locked: title.metadata.locked,
    metadataStatus: title.metadata.status,
  };
}
