import type { ChildProcess } from 'node:child_process';
import { createReadStream, promises as fs } from 'node:fs';
import type { Request, Response } from 'express';
import { createLogger } from '../util/log.js';
import { buildStreamArgs, spawnFfmpeg, type StreamArgsOptions } from './ffmpeg.js';

const log = createLogger('stream');

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4', // QuickTime/H.264 plays in browsers when labelled as MP4
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  asf: 'video/x-ms-asf',
  flv: 'video/x-flv',
  ogv: 'video/ogg',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mts: 'video/mp2t',
  '3gp': 'video/3gpp',
};

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Parse a single `bytes=` range. Returns null for unsatisfiable ranges. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.split(',')[0]!.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  let start: number;
  let end: number;
  if (rawStart === '') {
    // suffix range: last N bytes
    const suffix = Number(rawEnd);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}

/** Serve a file with HTTP Range support (seeking in the browser's <video>). */
export async function sendFileWithRanges(req: Request, res: Response, file: string, contentType: string): Promise<void> {
  let size: number;
  let mtime: Date;
  try {
    const st = await fs.stat(file);
    size = st.size;
    mtime = st.mtime;
  } catch {
    res.status(404).json({ error: 'The video file is not reachable. Is the drive or network share connected?' });
    return;
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);
  res.setHeader('Last-Modified', mtime.toUTCString());
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

  const rangeHeader = req.headers.range;
  let start = 0;
  let end = size - 1;
  if (rangeHeader) {
    const range = parseRange(rangeHeader, size);
    if (!range) {
      res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
      return;
    }
    ({ start, end } = range);
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  } else {
    res.status(200);
  }
  res.setHeader('Content-Length', String(end - start + 1));
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end, highWaterMark: 1024 * 1024 });
  stream.on('error', (err) => {
    log.warn(`Read error for ${file}`, err);
    res.destroy(err);
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

/** Tracks running ffmpeg streams so they can be capped and cleaned up. */
export class StreamManager {
  private readonly active = new Map<number, { child: ChildProcess; key: string; startedAt: number }>();
  private seq = 0;

  constructor(private readonly ffmpeg: string, private readonly maxConcurrent = 4) {}

  get count(): number {
    return this.active.size;
  }

  /**
   * Pipe a remuxed/transcoded fragmented MP4 to the response.
   * `sessionKey` identifies a viewer+file: a new request for the same key replaces the old stream
   * (the player restarts the stream on every seek).
   */
  stream(req: Request, res: Response, sessionKey: string, opts: StreamArgsOptions): void {
    for (const [id, entry] of this.active) {
      if (entry.key === sessionKey) this.kill(id);
    }
    if (this.active.size >= this.maxConcurrent) {
      const oldest = [...this.active.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0];
      if (oldest) this.kill(oldest[0]);
    }
    const args = buildStreamArgs(opts);
    log.debug(`ffmpeg ${args.join(' ')}`);
    const child = spawnFfmpeg(this.ffmpeg, args);
    const id = ++this.seq;
    this.active.set(id, { child, key: sessionKey, startedAt: Date.now() });

    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 8000) stderr += chunk.toString();
    });
    child.on('error', (err) => {
      log.error('Could not start ffmpeg', err);
      this.active.delete(id);
      if (!res.headersSent) res.status(500).json({ error: 'Could not start ffmpeg' });
      else res.destroy();
    });
    child.on('close', (code, signal) => {
      this.active.delete(id);
      if (code && code !== 0 && signal === null && !res.writableEnded) {
        log.warn(`ffmpeg exited with ${code}: ${stderr.trim().slice(0, 500)}`);
      }
      if (!res.writableEnded) res.end();
    });

    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Stream-Start', String(opts.start));
    res.flushHeaders();
    child.stdout?.pipe(res);
    const cleanup = (): void => this.kill(id);
    req.on('close', cleanup);
    res.on('close', cleanup);
  }

  kill(id: number): void {
    const entry = this.active.get(id);
    if (!entry) return;
    this.active.delete(id);
    entry.child.stdout?.unpipe();
    entry.child.kill('SIGTERM');
    setTimeout(() => {
      if (entry.child.exitCode === null && entry.child.signalCode === null) entry.child.kill('SIGKILL');
    }, 3000).unref();
  }

  killAll(): void {
    for (const id of [...this.active.keys()]) this.kill(id);
  }
}
