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
const MAX_REDIRECTS = 3;
/** Cap for downloaded artwork; the least recently fetched files go first. */
const REMOTE_CACHE_MAX_BYTES = (Number(process.env.IMAGE_CACHE_MAX_MB) || 2048) * 1024 * 1024;

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
  private downloadedSincePrune = 0;
  private pruning: Promise<void> | null = null;

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

  /** Fetch with redirects followed by hand, so every hop has to pass the host allowlist too. */
  private async fetchAllowed(url: string, signal: AbortSignal): Promise<{ res: globalThis.Response; finalUrl: string }> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'HomeBlockbuster/1.0 (+https://github.com/swissmarley/home-blockbuster)' },
      });
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) return { res, finalUrl: current };
      await res.body?.cancel();
      const next = new URL(location, current).toString();
      if (!ImageCache.isAllowedRemote(next)) throw new Error(`Redirect to a host that is not allowed: ${next}`);
      current = next;
    }
    throw new Error('Too many redirects');
  }

  /** Read a response body, giving up as soon as it grows past MAX_BYTES. */
  private static async readLimited(res: globalThis.Response): Promise<Buffer> {
    const declared = Number(res.headers.get('content-length'));
    if (declared > MAX_BYTES) throw new Error(`Image too large (${declared} bytes)`);
    if (!res.body) return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > MAX_BYTES) throw new Error('Image too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  private async download(url: string, base: string): Promise<CachedImage | null> {
    try {
      const { res, finalUrl } = await this.fetchAllowed(url, AbortSignal.timeout(25_000));
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      const ext = EXT_BY_MIME[mime] ?? path.extname(new URL(finalUrl).pathname).slice(1).toLowerCase();
      if (!MIME_BY_EXT[ext]) {
        await res.body?.cancel();
        throw new Error(`Unexpected content type ${mime}`);
      }
      const buf = await ImageCache.readLimited(res);
      if (buf.length === 0) throw new Error('Empty image');
      const file = `${base}.${ext}`;
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, file);
      this.failures.delete(url);
      if (this.failures.size > 5000) this.failures.clear();
      if (++this.downloadedSincePrune >= 200) {
        this.downloadedSincePrune = 0;
        this.pruning ??= this.prune().finally(() => (this.pruning = null));
      }
      return { path: file, mime: MIME_BY_EXT[ext]! };
    } catch (err) {
      this.failures.set(url, Date.now());
      log.debug(`Image download failed: ${url}`, err);
      return null;
    }
  }

  /** Keep the downloaded-artwork cache under REMOTE_CACHE_MAX_BYTES by deleting the oldest files. */
  async prune(maxBytes = REMOTE_CACHE_MAX_BYTES): Promise<void> {
    try {
      const names = await fs.readdir(this.remoteDir);
      const files: Array<{ file: string; size: number; mtimeMs: number }> = [];
      for (const name of names) {
        const file = path.join(this.remoteDir, name);
        try {
          const st = await fs.stat(file);
          if (st.isFile()) files.push({ file, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          // removed meanwhile
        }
      }
      let total = files.reduce((n, f) => n + f.size, 0);
      if (total <= maxBytes) return;
      files.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const f of files) {
        if (total <= maxBytes * 0.9) break;
        await fs.rm(f.file, { force: true });
        total -= f.size;
      }
      log.info(`Trimmed the artwork cache to ${Math.round(total / 1024 / 1024)} MB`);
    } catch (err) {
      log.warn('Could not trim the artwork cache', err);
    }
  }

  /** Warm the cache in the background (errors are ignored). */
  prefetch(urls: Array<string | null | undefined>): void {
    for (const url of urls) {
      if (url && /^https?:\/\//.test(url)) void this.remote(url);
    }
  }
}
