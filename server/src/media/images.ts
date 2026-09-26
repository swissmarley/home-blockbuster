import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Semaphore } from '../util/concurrency.js';
import { createLogger } from '../util/log.js';

const log = createLogger('images');

const ALLOWED_HOSTS = [
  /^image\.tmdb\.org$/,
  /^static\.tvmaze\.com$/,
  /^is\d+(-ssl)?\.mzstatic\.com$/,
  /^m\.media-amazon\.com$/,
  /^images-na\.ssl-images-amazon\.com$/,
  /^ia\.media-imdb\.com$/,
  /^img\.omdbapi\.com$/,
];

/** Additional "host[:port]" entries allowed through the image proxy (e.g. a TMDB mirror). */
const EXTRA_HOSTS = (process.env.IMAGE_PROXY_EXTRA_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
};

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
};

const LOCAL_NAME = /^[a-z0-9][a-z0-9_-]{0,120}\.(jpg|png|webp|gif)$/;
const MAX_BYTES = 20 * 1024 * 1024;

export interface CachedImage {
  path: string;
  mime: string;
}

/** Convert a stored image reference into a URL the browser can load. */
export function imageUrl(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('local:')) return `/api/img/local/${ref.slice(6)}`;
  if (/^https?:\/\//.test(ref)) return `/api/img?u=${encodeURIComponent(ref)}`;
  return null;
}

export class ImageCache {
  readonly localDir: string;
  readonly remoteDir: string;
  private readonly inflight = new Map<string, Promise<CachedImage | null>>();
  private readonly downloads = new Semaphore(6);
  private readonly failures = new Map<string, number>();

  constructor(cacheDir: string) {
    this.localDir = path.join(cacheDir, 'images', 'local');
    this.remoteDir = path.join(cacheDir, 'images', 'remote');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.localDir, { recursive: true });
    await fs.mkdir(this.remoteDir, { recursive: true });
  }

  static isAllowedRemote(url: string): boolean {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      return ALLOWED_HOSTS.some((re) => re.test(u.hostname)) || EXTRA_HOSTS.includes(u.host.toLowerCase());
    } catch {
      return false;
    }
  }

  /** Store bytes (e.g. embedded cover art, a grabbed frame) and return an image ref. */
  async saveLocal(baseName: string, data: Uint8Array, mime = 'image/jpeg'): Promise<string> {
    const ext = EXT_BY_MIME[mime] ?? 'jpg';
    const name = `${baseName.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}.${ext}`;
    await fs.writeFile(path.join(this.localDir, name), data);
    return `local:${name}`;
  }

  localFile(ref: string): string | null {
    const name = ref.startsWith('local:') ? ref.slice(6) : ref;
    return LOCAL_NAME.test(name) ? path.join(this.localDir, name) : null;
  }

  async localImage(name: string): Promise<CachedImage | null> {
    const file = this.localFile(name);
    if (!file) return null;
    try {
      await fs.access(file);
    } catch {
      return null;
    }
    const ext = path.extname(file).slice(1);
    return { path: file, mime: MIME_BY_EXT[ext] ?? 'application/octet-stream' };
  }

  async removeLocal(ref: string | null | undefined): Promise<void> {
    if (!ref?.startsWith('local:')) return;
    const file = this.localFile(ref);
    if (file) await fs.rm(file, { force: true }).catch(() => undefined);
  }

  private remotePathBase(url: string): string {
    return path.join(this.remoteDir, createHash('sha1').update(url).digest('hex'));
  }

  /** Fetch a remote image through the disk cache. */
  async remote(url: string): Promise<CachedImage | null> {
    if (!ImageCache.isAllowedRemote(url)) return null;
    const base = this.remotePathBase(url);
    for (const ext of ['jpg', 'png', 'webp', 'svg', 'gif']) {
      try {
        await fs.access(`${base}.${ext}`);
        return { path: `${base}.${ext}`, mime: MIME_BY_EXT[ext]! };
      } catch {
        // not cached with this extension
      }
    }
    const failedAt = this.failures.get(url);
    if (failedAt && Date.now() - failedAt < 10 * 60_000) return null;
    let pending = this.inflight.get(url);
    if (!pending) {
      pending = this.downloads.run(() => this.download(url, base)).finally(() => this.inflight.delete(url));
      this.inflight.set(url, pending);
    }
    return pending;
  }

  private async download(url: string, base: string): Promise<CachedImage | null> {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(25_000),
        headers: { 'User-Agent': 'HomeBlockbuster/1.0 (+https://github.com/swissmarley/home-blockbuster)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const ext = EXT_BY_MIME[mime] ?? path.extname(new URL(url).pathname).slice(1).toLowerCase();
      if (!MIME_BY_EXT[ext]) throw new Error(`Unexpected content type ${mime}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) throw new Error(`Unexpected size ${buf.length}`);
      const file = `${base}.${ext}`;
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, file);
      this.failures.delete(url);
      return { path: file, mime: MIME_BY_EXT[ext]! };
    } catch (err) {
      this.failures.set(url, Date.now());
      log.debug(`Image download failed: ${url}`, err);
      return null;
    }
  }

  /** Warm the cache in the background (errors are ignored). */
  prefetch(urls: Array<string | null | undefined>): void {
    for (const url of urls) {
      if (url && /^https?:\/\//.test(url)) void this.remote(url);
    }
  }
}
