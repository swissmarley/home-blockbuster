import path from 'node:path';
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
import { titleKey } from './filenameParser.js';

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

/** Highest resolution first, then the largest file; reachable libraries before offline ones. */
function bestVersion(files: StoredFile[], online?: Set<string>): StoredFile {
  const pool = online ? files.filter((f) => online.has(f.libraryId)) : files;
  return [...(pool.length ? pool : files)].sort((a, b) => {
    const ha = a.probe?.video?.height ?? 0;
    const hb = b.probe?.video?.height ?? 0;
    return hb - ha || b.size - a.size;
  })[0]!;
}

/** One video of a movie title: a part, an edition, or another video that shares the title. */
export interface MovieEntry {
  /** Copies of the same video (other resolutions, other drives). */
  files: StoredFile[];
  best: StoredFile;
}

/** Same video when the lengths agree; different lengths mean different videos that share a name. */
function sameVideo(a: StoredFile, b: StoredFile): boolean {
  const da = a.probe?.duration;
  const db = b.probe?.duration;
  if (!da || !db) return true;
  return Math.abs(da - db) <= Math.max(3, Math.min(da, db) * 0.005);
}

const entryKey = (f: StoredFile): string =>
  `${f.parsed.part ?? 1}|${titleKey(f.parsed.edition ?? '')}|${titleKey(f.parsed.episodeTitle ?? '')}`;

/** The videos of a movie title in viewing order. More than one makes it a movie series. */
export function movieEntries(files: StoredFile[], online?: Set<string>): MovieEntry[] {
  const ordered = [...files].sort(
    (a, b) =>
      (a.parsed.part ?? 1) - (b.parsed.part ?? 1) ||
      (a.parsed.edition ?? '').localeCompare(b.parsed.edition ?? '') ||
      (a.parsed.episodeTitle ?? '').localeCompare(b.parsed.episodeTitle ?? '', undefined, { numeric: true }) ||
      a.relPath.localeCompare(b.relPath, undefined, { numeric: true }),
  );
  const groups: StoredFile[][] = [];
  const byKey = new Map<string, StoredFile[][]>();
  for (const f of ordered) {
    const key = entryKey(f);
    const sameKey = byKey.get(key) ?? [];
    const group = sameKey.find((g) => sameVideo(g[0]!, f));
    if (group) {
      group.push(f);
      continue;
    }
    sameKey.push([f]);
    byKey.set(key, sameKey);
    groups.push(sameKey[sameKey.length - 1]!);
  }
  return groups.map((g) => ({ files: g, best: bestVersion(g, online) }));
}

/** Best version of a movie: the first video (part), highest resolution, largest. */
export function bestMovieFile(files: StoredFile[], online?: Set<string>): StoredFile | null {
  const entries = movieEntries(files, online);
  const reachable = online ? entries.find((e) => online.has(e.best.libraryId)) : undefined;
  return (reachable ?? entries[0])?.best ?? null;
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

/** What plays after `currentId`: the next episode of a show, or the next video of a movie series. */
export function nextFileFor(title: StoredTitle, files: StoredFile[], currentId: string, online?: Set<string>): StoredFile | null {
  if (title.kind === 'show') return nextEpisodeFile(files, currentId);
  const entries = movieEntries(files, online);
  const index = entries.findIndex((e) => e.files.some((f) => f.id === currentId));
  return index >= 0 ? (entries[index + 1]?.best ?? null) : null;
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

function cleanStem(file: StoredFile): string {
  const stem = path.basename(file.relPath, path.extname(file.relPath));
  return /\s/.test(stem) ? stem : stem.replace(/[._]+/g, ' ').trim();
}

/** A video of a movie series as an episode: "Part 2", the name it stands for, or its file name. */
function entryDTO(title: StoredTitle, entries: MovieEntry[], index: number, file?: StoredFile): EpisodeDTO {
  const entry = entries[index]!;
  const f = file ?? entry.best;
  const numbered = entries.some((e) => e.best.parsed.part !== null);
  const part = f.parsed.part ?? (numbered ? 1 : null);
  const tagTitle = f.tags?.title && titleKey(f.tags.title) !== titleKey(title.name) ? f.tags.title.trim() : null;
  const edition = f.parsed.edition;
  const name =
    f.parsed.episodeTitle ??
    tagTitle ??
    (part !== null && edition ? `Part ${part} · ${edition}` : part !== null ? `Part ${part}` : (edition ?? cleanStem(f)));
  return {
    id: f.id,
    fileId: f.id,
    season: 1,
    episode: index + 1,
    episodeEnd: null,
    name,
    overview: f.tags?.description ?? '',
    still: imageUrl(f.thumb ?? f.cover),
    runtime: f.probe?.duration ? Math.round(f.probe.duration / 60) : null,
    airDate: null,
    duration: f.probe?.duration ?? null,
  };
}

/** The episode `file` stands for: a show episode, a video of a movie series, or null for a plain movie. */
export function episodeFor(title: StoredTitle, files: StoredFile[], file: StoredFile, online?: Set<string>): EpisodeDTO | null {
  if (title.kind === 'show') return episodeDTO(title, file);
  const entries = movieEntries(files, online);
  if (entries.length < 2) return null;
  const index = entries.findIndex((e) => e.files.some((f) => f.id === file.id));
  return index >= 0 ? entryDTO(title, entries, index, file) : null;
}

/** A movie series lists its videos as the episodes of a single season. */
function movieSeason(title: StoredTitle, entries: MovieEntry[]): SeasonDTO {
  return {
    number: 1,
    name: title.name,
    overview: '',
    poster: null,
    episodes: entries.map((_, i) => entryDTO(title, entries, i)),
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
  const entries = title.kind === 'movie' ? movieEntries(files, ctx.onlineLibraries) : [];
  if (title.kind === 'show') {
    for (const f of files) {
      const { season, episode } = episodeNumbers(f);
      if (season > 0) seasons.add(season);
      episodes.add(episodeKey(season, episode));
    }
  }
  const people = [...title.cast.slice(0, 6).map((c) => c.name), ...title.directors, ...title.creators, ...title.studios];
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
    episodeCount: title.kind === 'show' ? episodes.size : entries.length > 1 ? entries.length : 0,
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
  const entries = title.kind === 'movie' ? movieEntries(files, ctx.onlineLibraries) : [];
  return {
    ...titleSummary(title, files, ctx),
    tagline: title.tagline,
    cast: title.cast.map((c) => ({ ...c, photo: imageUrl(c.photo) })),
    directors: title.directors,
    writers: title.writers,
    creators: title.creators,
    studios: title.studios,
    seasons: title.kind === 'show' ? seasonsOf(title, files) : entries.length > 1 ? [movieSeason(title, entries)] : [],
    files: (title.kind === 'show' ? sortEpisodes(files) : entries.flatMap((e) => e.files)).map(fileDTO),
    externalIds: title.externalIds,
    similar: similarTitles(title, all),
    locked: title.metadata.locked,
    metadataStatus: title.metadata.status,
  };
}
