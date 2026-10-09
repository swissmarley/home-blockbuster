import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import type { Database } from '../db.js';
import type { EventBus } from '../events.js';
import { grabFrame, type FfmpegInfo } from '../media/ffmpeg.js';
import type { ImageCache } from '../media/images.js';
import { MetadataUnavailableError } from '../metadata/errors.js';
import type { IdentifyResult, MetadataService } from '../metadata/service.js';
import type { ExternalIds, LibraryKind, ProviderId, ScanProgress, SettingsDTO } from '../shared/types.js';
import type { EmbeddedTags, ParsedName, StoredFile, StoredLibrary, StoredTitle } from '../types.js';
import { mapLimit, Semaphore } from '../util/concurrency.js';
import { hashId } from '../util/ids.js';
import { createLogger } from '../util/log.js';
import { cleanTitle, isExtraOrSample, isVideoFile, parseMediaPath, shouldSkipDirectory, sortName, titleKey } from './filenameParser.js';
import { episodeKey, episodeNumbers, playFileFor } from './present.js';
import { probeMedia } from './probe.js';
import type { MediaGuard } from './mediaGuard.js';
import type { LibraryRepo } from './repository.js';
import { embeddedSubtitleTracks, findSidecarSubtitles } from './subtitles.js';

const log = createLogger('scanner');

const PROVIDERS: ProviderId[] = ['tmdb', 'tvmaze', 'itunes', 'omdb'];
const isProvider = (source: string): source is ProviderId => (PROVIDERS as string[]).includes(source);
const MAX_METADATA_ATTEMPTS = 6;

interface FoundFile {
  abs: string;
  rel: string;
  size: number;
  mtimeMs: number;
}

interface Discovery {
  ok: boolean;
  error: string | null;
  rootEntries: number;
  files: FoundFile[];
  dirs: Map<string, string[]>;
}

type Job = { type: 'library'; libraryId: string; refresh: boolean } | { type: 'metadata'; refresh: boolean };

export interface ScannerDeps {
  db: Database;
  repo: LibraryRepo;
  images: ImageCache;
  ffmpeg: FfmpegInfo;
  metadata: MetadataService;
  events: EventBus;
  settings: () => SettingsDTO;
  guard: MediaGuard;
}

function idleProgress(): ScanProgress {
  return {
    running: false,
    libraryId: null,
    libraryName: null,
    phase: 'idle',
    processed: 0,
    total: 0,
    current: null,
    startedAt: null,
    finishedAt: null,
    message: null,
    queue: [],
  };
}

/** Provider-specific id stored on a title, used to refresh a known match. */
export function providerIdFor(title: StoredTitle): string | null {
  const ids = title.externalIds;
  switch (title.metadata.source) {
    case 'tmdb':
      return ids.tmdb != null ? String(ids.tmdb) : null;
    case 'tvmaze':
      return ids.tvmaze != null ? String(ids.tvmaze) : null;
    case 'itunes':
      return ids.itunes != null ? String(ids.itunes) : null;
    case 'omdb':
      return ids.imdb ?? null;
    default:
      return null;
  }
}

function sameIdentity(a: ExternalIds, b: ExternalIds): boolean {
  return (
    (a.tmdb != null && a.tmdb === b.tmdb) ||
    (a.tvmaze != null && a.tvmaze === b.tvmaze) ||
    (a.itunes != null && a.itunes === b.itunes) ||
    (a.imdb != null && a.imdb === b.imdb)
  );
}

const GENERIC_TITLE = /^(unknown|movie|video|film|title|clip|untitled|main|feature|vts[_ ]?\d+.*|t\d{1,2}|\d{1,3})$/i;
const JUNKY_TAG = /(www\.|\.com|\.org|\.net|https?:|\b(1080p|720p|2160p|x264|x265|hevc|web-?dl|bluray|brrip|yify|rarbg)\b)/i;

/** Embedded tags (iTunes TV atoms, clean titles, IMDb ids) refine what the file name says. */
export function applyEmbeddedHints(parsed: ParsedName, tags: EmbeddedTags | null, kind: LibraryKind): ParsedName {
  if (!tags) return parsed;
  const out = { ...parsed };
  if (tags.show && tags.episode != null && kind !== 'movies') {
    const show = cleanTitle(tags.show);
    if (show) {
      out.kind = 'episode';
      out.title = show;
      out.season = tags.season ?? out.season ?? 1;
      out.episode = tags.episode;
      if (!out.episodeTitle && tags.title && tags.title !== tags.show && !JUNKY_TAG.test(tags.title)) {
        out.episodeTitle = tags.title.trim();
      }
    }
  } else if (out.kind === 'movie' && tags.title && !JUNKY_TAG.test(tags.title)) {
    const tagTitle = cleanTitle(tags.title);
    if (tagTitle && GENERIC_TITLE.test(out.title)) {
      out.title = tagTitle;
      if (!out.year && tags.year) out.year = tags.year;
    } else if (tagTitle && titleKey(tagTitle) === titleKey(out.title) && !out.year && tags.year) {
      out.year = tags.year;
    }
  }
  if (!out.imdbId && tags.imdbId) out.imdbId = tags.imdbId;
  return out;
}

export class Scanner {
  private readonly queue: Job[] = [];
  private running = false;
  private progress: ScanProgress = idleProgress();
  private readonly cancelled = new Set<string>();
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly deps: ScannerDeps) {}

  /** Resolves once every queued job has finished. */
  whenIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  status(): ScanProgress {
    return { ...this.progress, queue: this.queue.flatMap((j) => (j.type === 'library' ? [j.libraryId] : [])) };
  }

  private library(id: string): StoredLibrary | undefined {
    return this.deps.db.state.data.libraries.find((l) => l.id === id);
  }

  enqueue(libraryId: string, opts: { refresh?: boolean } = {}): void {
    const lib = this.library(libraryId);
    if (!lib) return;
    const existing = this.queue.find((j) => j.type === 'library' && j.libraryId === libraryId);
    if (existing) {
      if (opts.refresh && existing.type === 'library') existing.refresh = true;
      return;
    }
    this.cancelled.delete(libraryId);
    this.queue.push({ type: 'library', libraryId, refresh: Boolean(opts.refresh) });
    if (lib.status !== 'scanning') lib.status = 'queued';
    this.deps.db.state.save();
    this.deps.events.librariesChanged();
    this.publish();
    void this.drain();
  }

  enqueueAll(opts: { refresh?: boolean } = {}): void {
    for (const lib of this.deps.db.state.data.libraries) this.enqueue(lib.id, opts);
  }

  /** Re-run metadata matching (e.g. after adding an API key) without rescanning the disks. */
  enqueueMetadata(opts: { refresh?: boolean; retryUnmatched?: boolean } = {}): void {
    if (opts.retryUnmatched) {
      for (const t of this.deps.repo.titles()) {
        if (!t.metadata.locked && (t.metadata.status === 'unmatched' || t.metadata.status === 'error')) {
          t.metadata.status = 'pending';
          t.metadata.attempts = 0;
        }
      }
    }
    if (!this.queue.some((j) => j.type === 'metadata')) this.queue.push({ type: 'metadata', refresh: Boolean(opts.refresh) });
    this.publish();
    void this.drain();
  }

  /** Stop scanning a library (used when it's deleted). */
  cancel(libraryId: string): void {
    this.cancelled.add(libraryId);
    const index = this.queue.findIndex((j) => j.type === 'library' && j.libraryId === libraryId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private publish(): void {
    this.deps.events.scanProgress(this.status());
  }

  private setPhase(phase: ScanProgress['phase'], total: number, message: string | null = null): void {
    this.progress.phase = phase;
    this.progress.total = total;
    this.progress.processed = 0;
    this.progress.current = null;
    this.progress.message = message;
    this.publish();
  }

  private tick(current: string | null): void {
    if (!this.progress.running) return; // e.g. thumbnails made for a manual refresh
    this.progress.processed++;
    this.progress.current = current;
    this.publish();
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let job: Job | undefined;
      while ((job = this.queue.shift())) {
        this.progress = { ...idleProgress(), running: true, startedAt: Date.now() };
        try {
          if (job.type === 'library') {
            const lib = this.library(job.libraryId);
            if (lib && !this.cancelled.has(lib.id)) await this.scanLibrary(lib, job.refresh);
          } else {
            this.progress.libraryName = 'All libraries';
            const ids = this.deps.repo.titles().map((t) => t.id);
            await this.metadataPhase(ids, job.refresh);
            await this.artworkPhase(null);
          }
        } catch (err) {
          log.error('Scan job failed', err);
        }
        await this.deps.db.flush();
      }
    } finally {
      this.running = false;
      this.progress = { ...idleProgress(), phase: 'done', finishedAt: Date.now() };
      this.publish();
      this.deps.events.libraryChanged();
      this.deps.events.librariesChanged();
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }

  // -------------------------------------------------------------------------
  // Library scan
  // -------------------------------------------------------------------------

  private async scanLibrary(lib: StoredLibrary, refresh: boolean): Promise<void> {
    const { repo, db, events } = this.deps;
    const started = Date.now();
    log.info(`Scanning "${lib.name}" (${lib.path})`);
    this.progress.libraryId = lib.id;
    this.progress.libraryName = lib.name;
    lib.status = 'scanning';
    lib.error = null;
    db.state.save();
    events.librariesChanged();

    this.setPhase('discovering', 0, `Looking for videos in ${lib.path}`);
    const known = repo.filesOfLibrary(lib.id);
    const found = await this.discover(lib.path);
    if (this.cancelled.has(lib.id)) return;

    if (!found.ok || (found.files.length === 0 && known.length > 0)) {
      lib.status = 'offline';
      lib.error =
        found.error ??
        'No videos found. The drive or network share may be disconnected — existing titles were kept.';
      log.warn(`Library "${lib.name}" looks offline: ${lib.error}`);
      db.state.save();
      events.librariesChanged();
      return;
    }

    // Probe new / changed files.
    this.setPhase('probing', found.files.length, `Reading ${found.files.length} files`);
    const listDir = async (dir: string): Promise<string[]> => {
      const cached = found.dirs.get(dir);
      if (cached) return cached;
      try {
        const names = await fs.readdir(dir);
        found.dirs.set(dir, names);
        return names;
      } catch {
        found.dirs.set(dir, []);
        return [];
      }
    };
    const seen = new Set<string>();
    let changed = 0;
    await mapLimit(found.files, 3, async (f) => {
      if (this.cancelled.has(lib.id)) return;
      const id = hashId(`${lib.id}:${f.rel}`);
      seen.add(id);
      try {
        if (await this.processFile(lib, f, id, listDir)) changed++;
      } catch (err) {
        log.warn(`Failed to process ${f.abs}`, err);
      }
      this.tick(f.rel);
      if (changed > 0 && changed % 25 === 0) {
        repo.save();
        events.libraryChanged();
      }
    });
    if (this.cancelled.has(lib.id)) return;

    // Forget files that disappeared.
    let removed = 0;
    for (const file of known) {
      if (seen.has(file.id)) continue;
      await this.deps.images.removeLocal(file.cover);
      await this.deps.images.removeLocal(file.thumb);
      repo.deleteFile(file.id);
      removed++;
    }
    repo.save();
    events.libraryChanged();

    const titleIds = [...new Set(repo.filesOfLibrary(lib.id).map((f) => f.titleId))];
    await this.metadataPhase(titleIds, refresh);
    await this.artworkPhase(lib.id);

    lib.status = 'idle';
    lib.error = null;
    lib.lastScanAt = Date.now();
    db.state.save();
    events.librariesChanged();
    log.info(
      `Finished "${lib.name}": ${found.files.length} videos, ${changed} new/changed, ${removed} removed in ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
  }

  /** Walk the library folder. NAS friendly: bounded parallelism, symlink-loop safe. */
  private async discover(root: string): Promise<Discovery> {
    const result: Discovery = { ok: true, error: null, rootEntries: 0, files: [], dirs: new Map() };
    try {
      const st = await fs.stat(root);
      if (!st.isDirectory()) return { ...result, ok: false, error: 'The path is not a folder.' };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const error =
        code === 'ENOENT'
          ? 'Folder not found. Is the drive or network share connected/mounted?'
          : code === 'EACCES' || code === 'EPERM'
            ? 'Permission denied while reading the folder.'
            : `Cannot open folder (${code ?? 'error'}).`;
      return { ...result, ok: false, error };
    }

    const dirSem = new Semaphore(8);
    const statSem = new Semaphore(16);
    const visited = new Set<string>();

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 24) return;
      let real = dir;
      try {
        real = await fs.realpath(dir);
      } catch {
        // keep the given path
      }
      if (visited.has(real)) return;
      visited.add(real);

      let entries: Dirent[];
      try {
        entries = await dirSem.run(() => fs.readdir(dir, { withFileTypes: true }));
      } catch (err) {
        log.debug(`Cannot read ${dir}`, err);
        return;
      }
      if (depth === 0) result.rootEntries = entries.length;
      result.dirs.set(dir, entries.map((e) => e.name));

      const subdirs: string[] = [];
      await Promise.all(
        entries.map(async (entry) => {
          const abs = path.join(dir, entry.name);
          let isDir = entry.isDirectory();
          let isFile = entry.isFile();
          if (entry.isSymbolicLink()) {
            // Only follow links that stay inside a library, so a link dropped into a shared folder
            // can't publish other files on the server.
            const target = await this.deps.guard.resolve(abs);
            if (!target) return;
            try {
              const st = await statSem.run(() => fs.stat(target));
              isDir = st.isDirectory();
              isFile = st.isFile();
            } catch {
              return;
            }
          }
          if (isDir) {
            if (!shouldSkipDirectory(entry.name)) subdirs.push(abs);
            return;
          }
          if (!isFile || !isVideoFile(entry.name)) return;
          try {
            const st = await statSem.run(() => fs.stat(abs));
            if (isExtraOrSample(entry.name, st.size)) return;
            const rel = path.relative(root, abs).split(path.sep).join('/');
            result.files.push({ abs, rel, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
          } catch {
            // vanished or unreadable
          }
        }),
      );
      await Promise.all(subdirs.map((sub) => walk(sub, depth + 1)));
    };

    await walk(root, 0);
    result.files.sort((a, b) => a.rel.localeCompare(b.rel));
    return result;
  }

  /** Returns true when the file was new or changed. */
  private async processFile(
    lib: StoredLibrary,
    f: FoundFile,
    id: string,
    listDir: (dir: string) => Promise<string[]>,
  ): Promise<boolean> {
    const { repo, images, ffmpeg } = this.deps;
    const existing = repo.file(id);
    const unchanged = existing !== undefined && existing.size === f.size && existing.mtimeMs === f.mtimeMs;

    let probe = existing?.probe ?? null;
    let tags = existing?.tags ?? null;
    let cover = existing?.cover ?? null;
    if (!unchanged) {
      const out = await probeMedia(f.abs, ffmpeg.ffprobe);
      probe = out.probe;
      tags = out.tags;
      if (out.cover) cover = await images.saveLocal(`cover-${id}`, out.cover.data, out.cover.mime);
      else if (cover) {
        await images.removeLocal(cover);
        cover = null;
      }
    }

    const parsed = applyEmbeddedHints(parseMediaPath(f.rel, lib.kind), tags, lib.kind);
    const subtitles = [
      ...(await findSidecarSubtitles(f.abs, listDir)),
      ...embeddedSubtitleTracks(probe?.subtitles ?? []),
    ];
    const kind = parsed.kind === 'episode' ? 'show' : 'movie';
    const title = repo.titleFor(kind, parsed.title, parsed.year);

    let thumb = existing?.thumb ?? null;
    let thumbAttempted = existing?.thumbAttempted ?? false;
    if (!unchanged && thumb) {
      await images.removeLocal(thumb);
      thumb = null;
      thumbAttempted = false;
    }

    const now = Date.now();
    const file: StoredFile = {
      id,
      libraryId: lib.id,
      path: f.abs,
      relPath: f.rel,
      size: f.size,
      mtimeMs: f.mtimeMs,
      ext: path.extname(f.abs).slice(1).toLowerCase(),
      titleId: title.id,
      parsed,
      probe,
      tags,
      cover,
      thumb,
      thumbAttempted,
      subtitles,
      addedAt: existing?.addedAt ?? now,
      updatedAt: unchanged ? (existing?.updatedAt ?? now) : now,
    };
    repo.putFile(file);
    return !unchanged || existing?.titleId !== title.id;
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  private needsMetadata(t: StoredTitle, refresh: boolean): boolean {
    if (refresh) return true;
    const m = t.metadata;
    if (m.status === 'pending') return true;
    if (m.status === 'error') return m.attempts < MAX_METADATA_ATTEMPTS;
    if (m.status === 'matched' && t.kind === 'show') {
      const seasons = this.seasonsOf(t);
      return seasons.some((s) => !m.seasonsFetched.includes(s));
    }
    return false;
  }

  private seasonsOf(t: StoredTitle): number[] {
    return [...new Set(this.deps.repo.filesOf(t.id).map((f) => episodeNumbers(f).season))].sort((a, b) => a - b);
  }

  private async metadataPhase(titleIds: string[], refresh: boolean): Promise<void> {
    const { repo, events } = this.deps;
    const work = titleIds
      .map((id) => repo.title(id))
      .filter((t): t is StoredTitle => t !== undefined && this.needsMetadata(t, refresh));
    if (work.length === 0) return;
    this.setPhase('metadata', work.length, `Fetching metadata for ${work.length} titles`);
    await mapLimit(work, 2, async (t) => {
      if (repo.title(t.id)) {
        await this.identifyTitle(t, refresh);
        repo.save();
        events.libraryChanged();
      }
      this.tick(t.name);
    });
  }

  private externalIdsFromFiles(files: StoredFile[]): ExternalIds {
    const ids: ExternalIds = {};
    for (const f of files) {
      ids.imdb ??= f.parsed.imdbId ?? f.tags?.imdbId ?? undefined;
      ids.tmdb ??= f.parsed.tmdbId ?? undefined;
      ids.tvdb ??= f.parsed.tvdbId ?? undefined;
    }
    return ids;
  }

  /** Match (or refresh) one title against the metadata providers. */
  async identifyTitle(t: StoredTitle, refresh: boolean): Promise<void> {
    const { repo, metadata } = this.deps;
    const files = repo.filesOf(t.id);
    if (files.length === 0) return;
    const seasons = t.kind === 'show' ? this.seasonsOf(t) : [];

    // Already matched show with new seasons on disk: only fetch the missing episode data.
    if (!refresh && t.metadata.status === 'matched' && t.kind === 'show') {
      const missing = seasons.filter((s) => !t.metadata.seasonsFetched.includes(s));
      const source = t.metadata.source;
      const pid = providerIdFor(t);
      if (missing.length && isProvider(source) && pid) {
        try {
          const episodes = await metadata.episodes(source, pid, missing);
          for (const e of episodes) {
            t.episodes[episodeKey(e.season, e.episode)] = {
              name: e.name,
              overview: e.overview,
              still: e.still,
              airDate: e.airDate,
              runtime: e.runtime,
            };
          }
          t.metadata.seasonsFetched = [...new Set([...t.metadata.seasonsFetched, ...missing])];
          t.updatedAt = Date.now();
        } catch (err) {
          log.debug(`Episode refresh failed for ${t.name}`, err);
        }
      }
      return;
    }

    try {
      let result: IdentifyResult | null = null;
      const pid = providerIdFor(t);
      if (t.metadata.locked && isProvider(t.metadata.source) && pid) {
        result = await metadata.fetch(t.metadata.source, pid, t.kind, seasons);
      } else {
        result = await metadata.identify({
          kind: t.kind,
          name: t.parsedName,
          year: t.parsedYear,
          externalIds: this.externalIdsFromFiles(files),
          seasons,
        });
      }
      if (result) {
        this.applyResult(t, result, seasons);
        await this.mergeDuplicates(t);
      } else {
        this.applyFallback(t, files);
      }
    } catch (err) {
      t.metadata.attempts++;
      t.metadata.status = 'error';
      t.metadata.error = err instanceof Error ? err.message : String(err);
      if (!(err instanceof MetadataUnavailableError)) log.warn(`Metadata lookup failed for "${t.name}"`, err);
      if (!t.overview) this.applyFallback(t, files, 'error');
    }
  }

  applyResult(t: StoredTitle, result: IdentifyResult, seasons: number[]): void {
    const p = result.title;
    t.name = p.name || t.name;
    t.sortName = sortName(t.name);
    t.year = p.year ?? t.parsedYear;
    t.overview = p.overview;
    t.tagline = p.tagline;
    t.genres = p.genres;
    t.tags = p.tags;
    t.rating = p.rating;
    t.voteCount = p.voteCount;
    t.popularity = p.popularity;
    t.maturity = p.maturity;
    t.runtime = p.runtime;
    t.releaseDate = p.releaseDate;
    t.images = p.images;
    t.cast = p.cast;
    t.directors = p.directors;
    t.writers = p.writers;
    t.creators = p.creators;
    t.studios = p.studios;
    t.externalIds = { ...p.externalIds };
    t.seasons = p.seasons;
    t.episodes = {};
    for (const e of result.episodes) {
      t.episodes[episodeKey(e.season, e.episode)] = {
        name: e.name,
        overview: e.overview,
        still: e.still,
        airDate: e.airDate,
        runtime: e.runtime,
      };
    }
    t.metadata = {
      ...t.metadata,
      status: 'matched',
      source: p.provider,
      fetchedAt: Date.now(),
      error: null,
      attempts: 0,
      seasonsFetched: t.kind === 'show' ? seasons : [],
    };
    t.updatedAt = Date.now();
    this.deps.images.prefetch([p.images.card, p.images.poster, p.images.logo, p.images.backdrop]);
  }

  /** No provider match: use embedded tags / the file name. */
  private applyFallback(t: StoredTitle, files: StoredFile[], status: 'unmatched' | 'error' = 'unmatched'): void {
    const play = playFileFor(t, files);
    const tags = t.kind === 'movie' ? play?.tags : null;
    const usedTags = Boolean(tags && (tags.description || tags.genres?.length));
    if (tags) {
      if (!t.overview && tags.description) t.overview = tags.description;
      if (!t.genres.length && tags.genres?.length) t.genres = tags.genres;
      t.year ??= t.parsedYear ?? tags.year ?? null;
    }
    t.metadata.status = status;
    if (status === 'unmatched') {
      t.metadata.source = usedTags || files.some((f) => f.cover) ? 'embedded' : 'filename';
      t.metadata.fetchedAt = Date.now();
      t.metadata.error = null;
    }
    t.updatedAt = Date.now();
  }

  /** Two folders resolving to the same movie/show become one title. */
  private async mergeDuplicates(t: StoredTitle): Promise<void> {
    const { repo } = this.deps;
    const dup = repo.titles().find((o) => o.id !== t.id && o.kind === t.kind && sameIdentity(o.externalIds, t.externalIds));
    if (!dup) return;
    log.info(`Merging "${t.name}" into existing title ${dup.id}`);
    // Keep the older title id (stable for "My List"), but carry the fresh metadata over.
    const fresh: StoredTitle = { ...t, id: dup.id, addedAt: Math.min(dup.addedAt, t.addedAt), metadata: { ...t.metadata } };
    repo.merge(t.id, dup.id);
    repo.putTitle(fresh);
    // The merged title may now have seasons whose episodes were never fetched.
    if (fresh.kind === 'show') await this.identifyTitle(fresh, false);
  }

  /** Manual "Fix match": pin a title to a provider entry. */
  async matchTitle(titleId: string, provider: ProviderId, providerId: string): Promise<StoredTitle | null> {
    const { repo, metadata } = this.deps;
    const t = repo.title(titleId);
    if (!t) return null;
    const seasons = t.kind === 'show' ? this.seasonsOf(t) : [];
    const result = await metadata.fetch(provider, providerId, t.kind, seasons);
    if (!result) return null;
    t.metadata.locked = true;
    this.applyResult(t, result, seasons);
    await this.mergeDuplicates(t);
    repo.save();
    this.deps.events.libraryChanged();
    const final = repo.title(titleId) ?? repo.titles().find((o) => sameIdentity(o.externalIds, result.title.externalIds));
    if (final) void this.thumbnailsFor(repo.filesOf(final.id));
    return final ?? null;
  }

  /** Re-fetch metadata for one title (keeps a manual match). */
  async refreshTitle(titleId: string): Promise<StoredTitle | null> {
    const t = this.deps.repo.title(titleId);
    if (!t) return null;
    await this.identifyTitle(t, true);
    this.deps.repo.save();
    this.deps.events.libraryChanged();
    const final = this.deps.repo.title(titleId);
    if (final) void this.thumbnailsFor(this.deps.repo.filesOf(final.id));
    return final ?? null;
  }

  /** Forget a manual match and identify automatically again. */
  async unlockTitle(titleId: string): Promise<StoredTitle | null> {
    const t = this.deps.repo.title(titleId);
    if (!t) return null;
    t.metadata.locked = false;
    return this.refreshTitle(titleId);
  }

  // -------------------------------------------------------------------------
  // Artwork (frames grabbed from the video itself)
  // -------------------------------------------------------------------------

  private needsThumb(f: StoredFile): boolean {
    if (f.thumb || f.thumbAttempted) return false;
    const t = this.deps.repo.title(f.titleId);
    if (!t) return false;
    if (t.kind === 'movie') return !t.images.backdrop && !t.images.card;
    const { season, episode } = episodeNumbers(f);
    return !t.episodes[episodeKey(season, episode)]?.still;
  }

  private async thumbnailsFor(files: StoredFile[]): Promise<number> {
    const { ffmpeg, images, repo, events } = this.deps;
    if (!ffmpeg.ffmpeg || !this.deps.settings().generateThumbnails) return 0;
    const work = files.filter((f) => this.needsThumb(f));
    let made = 0;
    await mapLimit(work, 2, async (f) => {
      const t = repo.title(f.titleId);
      const d = f.probe?.duration ?? 0;
      const at = d > 0 ? d * (t?.kind === 'movie' ? 0.18 : 0.3) : 20;
      const width = t?.kind === 'movie' ? 1280 : 640;
      const buf = await grabFrame(ffmpeg.ffmpeg!, f.path, Math.min(at, Math.max(0, d - 1)), width);
      f.thumbAttempted = true;
      if (buf) {
        f.thumb = await images.saveLocal(`thumb-${f.id}`, buf);
        made++;
      }
      this.tick(t?.name ?? f.relPath);
      if (made % 10 === 0) {
        repo.save();
        events.libraryChanged();
      }
    });
    repo.save();
    if (made) events.libraryChanged();
    return made;
  }

  private async artworkPhase(libraryId: string | null): Promise<void> {
    const { repo, ffmpeg } = this.deps;
    if (!ffmpeg.ffmpeg || !this.deps.settings().generateThumbnails) return;
    const files = (libraryId ? repo.filesOfLibrary(libraryId) : repo.files()).filter((f) => this.needsThumb(f));
    if (files.length === 0) return;
    this.setPhase('artwork', files.length, `Creating ${files.length} thumbnails`);
    await this.thumbnailsFor(files);
  }
}
