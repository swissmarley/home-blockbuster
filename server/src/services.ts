import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { Database } from './db.js';
import { EventBus } from './events.js';
import { MediaGuard } from './library/mediaGuard.js';
import type { PresentContext } from './library/present.js';
import { LibraryRepo } from './library/repository.js';
import { Scanner } from './library/scanner.js';
import { detectFfmpeg, type FfmpegInfo } from './media/ffmpeg.js';
import { ImageCache } from './media/images.js';
import { StreamManager } from './media/stream.js';
import { MetadataService } from './metadata/service.js';
import type { SettingsDTO } from './shared/types.js';
import type { FetchJson } from './types.js';

export interface Services {
  config: AppConfig;
  db: Database;
  repo: LibraryRepo;
  images: ImageCache;
  ffmpeg: FfmpegInfo;
  metadata: MetadataService;
  scanner: Scanner;
  events: EventBus;
  streams: StreamManager | null;
  /** Checks media paths against the library folders before they are read. */
  guard: MediaGuard;
  cacheDir: string;
  /** Stored settings with environment-provided API keys applied. */
  settings(): SettingsDTO;
  onlineLibraries(): Set<string>;
  present(): PresentContext;
}

export interface ServiceOverrides {
  ffmpeg?: FfmpegInfo;
  fetchJson?: FetchJson;
}

export async function createServices(config: AppConfig, overrides: ServiceOverrides = {}): Promise<Services> {
  await fs.mkdir(config.dataDir, { recursive: true });
  const cacheDir = path.join(config.dataDir, 'cache');
  const db = new Database(config.dataDir);
  await db.load();
  const repo = new LibraryRepo(db.library);
  const images = new ImageCache(cacheDir);
  await images.init();
  void images.prune();
  const ffmpeg = overrides.ffmpeg ?? (await detectFfmpeg({ ffmpegPath: config.ffmpegPath, ffprobePath: config.ffprobePath }));
  const events = new EventBus();

  const settings = (): SettingsDTO => {
    const s = db.state.data.settings;
    const tmdbFromEnv = !s.tmdbApiKey && Boolean(config.tmdbApiKey);
    const omdbFromEnv = !s.omdbApiKey && Boolean(config.omdbApiKey);
    return {
      ...s,
      tmdbApiKey: tmdbFromEnv ? config.tmdbApiKey! : s.tmdbApiKey,
      omdbApiKey: omdbFromEnv ? config.omdbApiKey! : s.omdbApiKey,
      tmdbFromEnv,
      omdbFromEnv,
    };
  };

  const metadata = new MetadataService({ getSettings: settings, fetchJson: overrides.fetchJson });
  const guard = new MediaGuard(() => [...db.state.data.libraries.map((l) => l.path), ...config.mediaRoots], config.allowExternalSymlinks);
  const scanner = new Scanner({ db, repo, images, ffmpeg, metadata, events, settings, guard });
  const streams = ffmpeg.ffmpeg ? new StreamManager(ffmpeg.ffmpeg) : null;

  // A crash mid-scan could leave libraries marked as busy.
  for (const lib of db.state.data.libraries) {
    if (lib.status === 'scanning' || lib.status === 'queued') lib.status = 'idle';
  }

  const onlineLibraries = (): Set<string> =>
    new Set(db.state.data.libraries.filter((l) => l.status !== 'offline').map((l) => l.id));

  return {
    config,
    db,
    repo,
    images,
    ffmpeg,
    metadata,
    scanner,
    events,
    streams,
    guard,
    cacheDir,
    settings,
    onlineLibraries,
    present: () => ({ onlineLibraries: onlineLibraries(), ffmpeg: Boolean(ffmpeg.ffmpeg) }),
  };
}
