import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  /** Directory holding the built web client (index.html), or null in API-only/dev mode. */
  webDir: string | null;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  /** When set, the UI and API require this password. */
  password: string | null;
  tmdbApiKey: string | null;
  omdbApiKey: string | null;
  /** Extra folders offered as shortcuts by the folder browser (e.g. Docker volume mounts). */
  mediaRoots: string[];
  version: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  // Works from both server/src (tsx) and dist/server (compiled): the repo root is two levels up.
  for (const candidate of [path.resolve(here, '../../package.json'), path.resolve(here, '../package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'home-blockbuster' && pkg.version) return pkg.version;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0';
}

function findWebDir(): string | null {
  const candidates = [
    process.env.WEB_DIR,
    path.resolve(here, '../web'), // dist/server -> dist/web
    path.resolve(here, '../../dist/web'), // server/src -> dist/web
  ].filter((p): p is string => Boolean(p));
  return candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? null;
}

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: Number.parseInt(env.PORT ?? '', 10) || 8585,
    host: env.HOST?.trim() || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR?.trim() || 'data'),
    webDir: findWebDir(),
    ffmpegPath: nonEmpty(env.FFMPEG_PATH),
    ffprobePath: nonEmpty(env.FFPROBE_PATH),
    password: nonEmpty(env.HB_PASSWORD),
    tmdbApiKey: nonEmpty(env.TMDB_API_KEY),
    omdbApiKey: nonEmpty(env.OMDB_API_KEY),
    mediaRoots: (env.MEDIA_ROOTS ?? '')
      .split(/[;,]/)
      .map((p) => p.trim())
      .filter(Boolean),
    version: readVersion(),
  };
}
