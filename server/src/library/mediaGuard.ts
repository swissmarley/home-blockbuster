import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../util/log.js';

const log = createLogger('media');

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

/** True when `child` is `root` or lies below it (both already resolved). */
export function isInside(child: string, root: string): boolean {
  const a = caseInsensitive ? child.toLowerCase() : child;
  const b = caseInsensitive ? root.toLowerCase() : root;
  const rel = path.relative(b, a);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Keeps symlinks inside a library from publishing files elsewhere on the server: a link is followed
 * only when its target lies inside one of the library folders (or MEDIA_ROOTS), unless
 * ALLOW_EXTERNAL_SYMLINKS is set.
 */
export class MediaGuard {
  private cache: { at: number; key: string; roots: string[] } | null = null;
  private readonly warned = new Set<string>();

  constructor(
    private readonly rootPaths: () => string[],
    readonly allowExternal = false,
  ) {}

  /** Real paths of every allowed root, refreshed when the configured folders change (or every 30 s). */
  async roots(): Promise<string[]> {
    const configured = this.rootPaths();
    const key = configured.join('\0');
    if (this.cache && this.cache.key === key && Date.now() - this.cache.at < 30_000) return this.cache.roots;
    const roots: string[] = [];
    for (const p of configured) {
      roots.push(path.resolve(p));
      try {
        const real = await fs.realpath(p);
        if (!roots.includes(real)) roots.push(real);
      } catch {
        // offline drive: keep the configured path only
      }
    }
    this.cache = { at: Date.now(), key, roots };
    return roots;
  }

  async allowed(realPath: string): Promise<boolean> {
    if (this.allowExternal) return true;
    return (await this.roots()).some((root) => isInside(realPath, root));
  }

  /** Resolve a media path for reading; null when it is missing or (through a symlink) outside every library. */
  async resolve(file: string): Promise<string | null> {
    let real: string;
    try {
      real = await fs.realpath(file);
    } catch {
      return null;
    }
    if (await this.allowed(real)) return real;
    if (!this.warned.has(file) && this.warned.size < 200) {
      this.warned.add(file);
      log.warn(`Ignoring "${file}": it links to "${real}", outside your libraries (set ALLOW_EXTERNAL_SYMLINKS=1 to allow).`);
    }
    return null;
  }
}
