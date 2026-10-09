import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { isExtraOrSample, isVideoFile, shouldSkipDirectory } from '../library/filenameParser.js';
import { isInside } from '../library/mediaGuard.js';
import type { Services } from '../services.js';
import type { FsCheckResult, FsListing, FsRoot, LibraryDTO, LibraryKind } from '../shared/types.js';
import type { StoredLibrary } from '../types.js';
import { randomId } from '../util/ids.js';
import { ApiError, badRequest, body, notFound, param, queryString } from './util.js';

const KINDS: LibraryKind[] = ['movies', 'shows', 'mixed'];

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Accept local paths, mount points, Windows drives and UNC shares (\\NAS\share). */
export function normalizeLibraryPath(input: string): string {
  let p = input.trim().replace(/^["']|["']$/g, '');
  if (/^smb:\/\//i.test(p)) {
    throw badRequest(
      process.platform === 'win32'
        ? 'Use a UNC path like \\\\NAS\\Movies instead of smb:// URLs.'
        : 'Mount the network share first (see the README), then pick the mounted folder.',
    );
  }
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  if (process.platform === 'win32' && /^\/\//.test(p)) p = p.replace(/\//g, '\\');
  const isUnc = /^\\\\/.test(p);
  if (!isUnc && !path.isAbsolute(p)) throw badRequest('Please enter an absolute folder path.');
  const resolved = isUnc ? p : path.resolve(p);
  // Trim trailing separators but keep roots such as "/" and "C:\".
  return resolved.length > 3 ? resolved.replace(/[\\/]+$/, '') : resolved;
}

async function listRoots(extra: string[]): Promise<FsRoot[]> {
  const roots: FsRoot[] = [];
  const add = async (name: string, p: string, kind: FsRoot['kind']): Promise<void> => {
    if (!roots.some((r) => r.path === p) && (await isDir(p))) roots.push({ name, path: p, kind });
  };
  for (const r of extra) await add(path.basename(r) || r, r, 'mount');
  const home = os.homedir();

  if (process.platform === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') await add(`${letter}:`, `${letter}:\\`, 'drive');
    await add('Home', home, 'home');
    for (const sub of ['Videos', 'Downloads']) await add(sub, path.join(home, sub), 'home');
    return roots;
  }

  await add('Home', home, 'home');
  for (const sub of ['Movies', 'Videos', 'Downloads']) await add(sub, path.join(home, sub), 'home');
  const user = os.userInfo().username;
  const mountBases =
    process.platform === 'darwin'
      ? ['/Volumes']
      : ['/mnt', '/media', `/media/${user}`, `/run/media/${user}`, '/srv', '/data', '/volume1', '/volume2', '/share', '/nfs', '/storage'];
  for (const base of mountBases) {
    let entries: string[] = [];
    try {
      entries = (await fs.readdir(base, { withFileTypes: true }))
        .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      continue;
    }
    if (entries.length === 0) continue;
    for (const name of entries.sort()) {
      const full = path.join(base, name);
      if (base === '/media' && name === user) continue;
      await add(name, full, process.platform === 'darwin' ? 'drive' : 'mount');
    }
  }
  await add('Computer', '/', 'root');
  return roots;
}

/** Whether a video counts as a library entry, using the same rules as the scanner (no samples, trailers or extras). */
async function countsAsVideo(dir: string, name: string): Promise<boolean> {
  if (!isVideoFile(name)) return false;
  if (!isExtraOrSample(name, 0)) return true;
  // Only "sample" names depend on the file size; skip the stat for everything else.
  if (isExtraOrSample(name, Number.MAX_SAFE_INTEGER)) return false;
  try {
    return !isExtraOrSample(name, (await fs.stat(path.join(dir, name))).size);
  } catch {
    return false;
  }
}

/** Count videos below `root` with time/size limits so huge NAS shares don't stall the UI. */
async function quickVideoCount(root: string, budgetMs = 2500, maxDirs = 400): Promise<number> {
  const deadline = Date.now() + budgetMs;
  const queue = [root];
  let count = 0;
  let dirs = 0;
  while (queue.length && Date.now() < deadline && dirs < maxDirs) {
    const dir = queue.shift()!;
    dirs++;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !shouldSkipDirectory(e.name)) queue.push(path.join(dir, e.name));
      else if (e.isFile() && (await countsAsVideo(dir, e.name))) count++;
    }
  }
  return count;
}

export function libraryRoutes(services: Services): Router {
  const router = Router();
  const { db, repo, scanner, events, config } = services;

  const libraries = (): StoredLibrary[] => db.state.data.libraries;

  /** A folder may not be, contain, or sit inside another library: every file would be listed twice. */
  const assertNoOverlap = (folder: string, exceptId?: string): void => {
    for (const other of libraries()) {
      if (other.id === exceptId) continue;
      if (isInside(folder, other.path) && isInside(other.path, folder)) throw badRequest('This folder is already a library.');
      if (isInside(folder, other.path)) throw badRequest(`This folder is inside the library "${other.name}", which already includes it.`);
      if (isInside(other.path, folder)) {
        throw badRequest(`This folder contains the library "${other.name}". Remove that library first, or pick a different folder.`);
      }
    }
  };

  const toDTO = (lib: StoredLibrary): LibraryDTO => {
    const files = repo.filesOfLibrary(lib.id);
    return {
      ...lib,
      fileCount: files.length,
      titleCount: new Set(files.map((f) => f.titleId)).size,
    };
  };

  router.get('/libraries', (_req, res) => {
    res.json(libraries().map(toDTO));
  });

  router.post('/libraries', async (req, res) => {
    const input = body<{ name: string; path: string; kind: LibraryKind }>(req);
    if (typeof input.path !== 'string' || !input.path.trim()) throw badRequest('Choose a folder.');
    const folder = normalizeLibraryPath(input.path);
    if (!(await isDir(folder))) {
      throw badRequest('That folder does not exist or is not reachable from the server. Is the drive or share connected?');
    }
    assertNoOverlap(folder);
    const kind = KINDS.includes(input.kind as LibraryKind) ? (input.kind as LibraryKind) : 'mixed';
    const lib: StoredLibrary = {
      id: randomId(),
      name: (typeof input.name === 'string' && input.name.trim()) || path.basename(folder) || folder,
      path: folder,
      kind,
      createdAt: Date.now(),
      lastScanAt: null,
      status: 'idle',
      error: null,
    };
    libraries().push(lib);
    db.state.save();
    events.librariesChanged();
    scanner.enqueue(lib.id);
    res.status(201).json(toDTO(lib));
  });

  router.put('/libraries/:id', async (req, res) => {
    const lib = libraries().find((l) => l.id === param(req, 'id'));
    if (!lib) throw notFound('Library');
    const input = body<{ name: string; path: string; kind: LibraryKind }>(req);
    let rescan = false;
    if (typeof input.name === 'string' && input.name.trim()) lib.name = input.name.trim();
    if (typeof input.path === 'string' && input.path.trim()) {
      const folder = normalizeLibraryPath(input.path);
      if (folder !== lib.path) {
        if (!(await isDir(folder))) throw badRequest('That folder does not exist or is not reachable.');
        assertNoOverlap(folder, lib.id);
        lib.path = folder;
        rescan = true;
      }
    }
    if (input.kind && KINDS.includes(input.kind) && input.kind !== lib.kind) {
      lib.kind = input.kind;
      rescan = true;
    }
    db.state.save();
    events.librariesChanged();
    if (rescan) scanner.enqueue(lib.id);
    res.json(toDTO(lib));
  });

  router.delete('/libraries/:id', async (req, res) => {
    const id = param(req, 'id');
    const index = libraries().findIndex((l) => l.id === id);
    if (index < 0) throw notFound('Library');
    scanner.cancel(id);
    for (const file of repo.filesOfLibrary(id)) {
      await services.images.removeLocal(file.cover);
      await services.images.removeLocal(file.thumb);
      repo.deleteFile(file.id);
    }
    libraries().splice(index, 1);
    db.state.save();
    repo.save();
    events.librariesChanged();
    events.libraryChanged();
    res.json({ ok: true });
  });

  router.post('/libraries/:id/scan', (req, res) => {
    const lib = libraries().find((l) => l.id === param(req, 'id'));
    if (!lib) throw notFound('Library');
    scanner.enqueue(lib.id, { refresh: Boolean(body<{ refresh: boolean }>(req).refresh) });
    res.json(scanner.status());
  });

  router.post('/scan', (req, res) => {
    scanner.enqueueAll({ refresh: Boolean(body<{ refresh: boolean }>(req).refresh) });
    res.json(scanner.status());
  });

  router.get('/scan', (_req, res) => {
    res.json(scanner.status());
  });

  router.post('/metadata/refresh', (req, res) => {
    const input = body<{ refresh: boolean }>(req);
    scanner.enqueueMetadata({ retryUnmatched: true, refresh: Boolean(input.refresh) });
    res.json(scanner.status());
  });

  // ---------------------------------------------------------------------------
  // Folder browser (runs on the server, so paths are as the server sees them)
  // ---------------------------------------------------------------------------

  router.get('/fs/roots', async (_req, res) => {
    res.json({ roots: await listRoots(config.mediaRoots), separator: path.sep, platform: process.platform });
  });

  router.get('/fs/list', async (req, res) => {
    const raw = queryString(req, 'path');
    if (!raw) throw badRequest('Missing path');
    const dir = normalizeLibraryPath(raw);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      throw new ApiError(code === 'ENOENT' ? 404 : 403, code === 'ENOENT' ? 'Folder not found' : 'Cannot open this folder');
    }
    const folders: FsListing['entries'] = [];
    let videoCount = 0;
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory() || (e.isSymbolicLink() && (await isDir(full)))) {
        if (!shouldSkipDirectory(e.name)) folders.push({ name: e.name, path: full });
      } else if (e.isFile() && (await countsAsVideo(dir, e.name))) {
        videoCount++;
      }
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const parent = path.dirname(dir);
    const listing: FsListing = { path: dir, parent: parent !== dir ? parent : null, entries: folders, videoCount };
    res.json(listing);
  });

  router.post('/fs/check', async (req, res) => {
    const input = body<{ path: string }>(req);
    const result: FsCheckResult = { ok: false, exists: false, isDirectory: false, readable: false, videoCount: 0, error: null };
    try {
      const dir = normalizeLibraryPath(String(input.path ?? ''));
      const st = await fs.stat(dir);
      result.exists = true;
      result.isDirectory = st.isDirectory();
      if (!result.isDirectory) {
        result.error = 'This is a file, not a folder.';
      } else {
        await fs.readdir(dir);
        result.readable = true;
        result.videoCount = await quickVideoCount(dir);
        result.ok = true;
      }
    } catch (err) {
      if (err instanceof ApiError) result.error = err.message;
      else {
        const code = (err as NodeJS.ErrnoException).code;
        result.error =
          code === 'ENOENT'
            ? 'Folder not found on the server. Is the drive or share connected?'
            : code === 'EACCES' || code === 'EPERM'
              ? 'The server has no permission to read this folder.'
              : `Cannot open this folder (${code ?? 'error'}).`;
      }
    }
    res.json(result);
  });

  return router;
}
