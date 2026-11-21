import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from '../util/log.js';
import { buildCodecArgs, spawnFfmpeg, type StreamArgsOptions } from './ffmpeg.js';

const log = createLogger('hls');

/** Session ids are chosen by the client: a fresh one for every (re)start of a stream. */
export const HLS_SESSION = /^[A-Za-z0-9_-]{6,64}$/;
/** Files a session may serve. */
export const HLS_FILE = /^(init\.mp4|seg\d{5}\.m4s)$/;

const SEGMENT_SECONDS = 4;
const IDLE_MS = 90_000;

export function buildHlsArgs(opts: StreamArgsOptions, dir: string): string[] {
  return [
    ...buildCodecArgs(opts),
    '-avoid_negative_ts', 'make_zero',
    '-f', 'hls',
    '-hls_time', String(SEGMENT_SECONDS),
    '-hls_list_size', '0',
    '-hls_playlist_type', 'event',
    '-hls_segment_type', 'fmp4',
    '-hls_fmp4_init_filename', 'init.mp4',
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_filename', path.join(dir, 'seg%05d.m4s'),
    path.join(dir, 'index.m3u8'),
  ];
}

interface HlsSession {
  key: string;
  owner: string;
  fileId: string;
  dir: string;
  child: ChildProcess;
  lastAccess: number;
  exited: boolean;
  exitCode: number | null;
  stderr: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * HLS output for players that need it (iOS / AVPlayer can't play an unbounded fragmented-MP4 pipe).
 * ffmpeg writes an EVENT playlist and fMP4 segments into a per-session folder; the player seeks inside
 * what has been produced and starts a new session (with `start`) to jump further.
 */
export class HlsManager {
  private readonly sessions = new Map<string, HlsSession>();
  private readonly root: string;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly ffmpeg: string,
    cacheDir: string,
    private readonly maxConcurrent = 4,
  ) {
    this.root = path.join(cacheDir, 'hls');
    void fs.rm(this.root, { recursive: true, force: true }).catch(() => undefined);
    this.timer = setInterval(() => this.sweep(), 15_000);
    this.timer.unref();
  }

  get count(): number {
    return this.sessions.size;
  }

  private keyFor(owner: string, sessionId: string): string {
    return `${owner}|${sessionId}`;
  }

  get(owner: string, sessionId: string, fileId: string): HlsSession | undefined {
    const session = this.sessions.get(this.keyFor(owner, sessionId));
    if (!session || session.fileId !== fileId) return undefined;
    session.lastAccess = Date.now();
    return session;
  }

  /** Start a session, replacing this client's other sessions (one stream per device at a time). */
  async start(owner: string, sessionId: string, fileId: string, opts: StreamArgsOptions): Promise<HlsSession | null> {
    const key = this.keyFor(owner, sessionId);
    for (const s of [...this.sessions.values()]) {
      if (s.owner === owner) this.stop(s.key);
    }
    if (this.sessions.size >= this.maxConcurrent) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastAccess - b.lastAccess)[0];
      if (!oldest || Date.now() - oldest.lastAccess < 20_000) return null;
      this.stop(oldest.key);
    }
    const dir = path.join(this.root, createHash('sha1').update(key).digest('hex').slice(0, 20));
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const args = buildHlsArgs(opts, dir);
    log.debug(`ffmpeg ${args.join(' ')}`);
    const child = spawnFfmpeg(this.ffmpeg, args);
    const session: HlsSession = {
      key,
      owner,
      fileId,
      dir,
      child,
      lastAccess: Date.now(),
      exited: false,
      exitCode: null,
      stderr: '',
    };
    child.stdout?.resume();
    child.stderr?.on('data', (chunk: Buffer) => {
      if (session.stderr.length < 8000) session.stderr += chunk.toString();
    });
    child.on('error', (err) => {
      log.error('Could not start ffmpeg', err);
      session.exited = true;
      session.exitCode = -1;
    });
    child.on('close', (code) => {
      session.exited = true;
      session.exitCode = code;
      if (code && this.sessions.get(key) === session) log.warn(`ffmpeg (HLS) exited with ${code}: ${session.stderr.trim().slice(0, 500)}`);
    });
    this.sessions.set(key, session);
    return session;
  }

  /** The playlist once it lists at least one segment, with a start tag so players begin at the top. */
  async playlist(session: HlsSession, timeoutMs = 25_000): Promise<string | null> {
    const file = path.join(session.dir, 'index.m3u8');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const text = await fs.readFile(file, 'utf8');
        if (text.includes('#EXTINF')) {
          session.lastAccess = Date.now();
          return text.replace('#EXTM3U', '#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES');
        }
      } catch {
        // not written yet
      }
      if (session.exited || Date.now() > deadline) return null;
      await sleep(250);
    }
  }

  /** Path of a finished segment, waiting briefly for ffmpeg to produce it. */
  async segment(session: HlsSession, name: string, timeoutMs = 20_000): Promise<string | null> {
    const file = path.join(session.dir, name);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await exists(file)) {
        session.lastAccess = Date.now();
        return file;
      }
      if (session.exited || Date.now() > deadline) return null;
      await sleep(200);
    }
  }

  error(session: HlsSession): string | null {
    if (!session.exited || session.exitCode === 0) return null;
    return session.stderr.trim().split('\n').pop() ?? 'ffmpeg failed';
  }

  stop(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    if (!session.exited) {
      session.child.kill('SIGTERM');
      setTimeout(() => {
        if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGKILL');
      }, 3000).unref();
    }
    // Give in-flight segment responses a moment before deleting the folder.
    setTimeout(() => void fs.rm(session.dir, { recursive: true, force: true }).catch(() => undefined), 5000).unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const s of [...this.sessions.values()]) {
      if (now - s.lastAccess > IDLE_MS) this.stop(s.key);
    }
  }

  killAll(): void {
    clearInterval(this.timer);
    for (const key of [...this.sessions.keys()]) this.stop(key);
  }
}
