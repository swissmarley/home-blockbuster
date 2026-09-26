import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import type { SettingsDTO } from '../shared/types.js';
import { createLogger } from '../util/log.js';

const log = createLogger('ffmpeg');

export interface FfmpegInfo {
  ffmpeg: string | null;
  ffprobe: string | null;
  version: string | null;
  encoders: Set<string>;
}

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

/** Run a process to completion, collecting output. Kills it after `timeoutMs`. */
export function run(bin: string, args: string[], timeoutMs = 60_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    const out: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr });
    });
  });
}

async function works(bin: string): Promise<string | null> {
  try {
    const res = await run(bin, ['-hide_banner', '-version'], 10_000);
    if (res.code !== 0) return null;
    const firstLine = res.stdout.toString().split('\n')[0] ?? '';
    return firstLine.match(/version\s+(\S+)/)?.[1] ?? 'unknown';
  } catch {
    return null;
  }
}

function candidates(name: 'ffmpeg' | 'ffprobe', explicit: string | null, sibling: string | null): string[] {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const list: string[] = [];
  if (explicit) list.push(explicit);
  if (sibling) list.push(path.join(path.dirname(sibling), exe));
  list.push(exe);
  if (process.platform === 'darwin') list.push(`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`);
  if (process.platform === 'win32') {
    list.push(`C:\\ffmpeg\\bin\\${exe}`, `C:\\Program Files\\ffmpeg\\bin\\${exe}`);
  }
  if (process.platform === 'linux') list.push(`/usr/bin/${name}`, `/usr/local/bin/${name}`, `/usr/lib/jellyfin-ffmpeg/${name}`);
  return [...new Set(list)].filter((p) => !path.isAbsolute(p) || existsSync(p));
}

export async function detectFfmpeg(opts: { ffmpegPath: string | null; ffprobePath: string | null }): Promise<FfmpegInfo> {
  let ffmpeg: string | null = null;
  let version: string | null = null;
  for (const bin of candidates('ffmpeg', opts.ffmpegPath, null)) {
    version = await works(bin);
    if (version) {
      ffmpeg = bin;
      break;
    }
  }
  let ffprobe: string | null = null;
  for (const bin of candidates('ffprobe', opts.ffprobePath, ffmpeg)) {
    if (await works(bin)) {
      ffprobe = bin;
      break;
    }
  }
  const encoders = new Set<string>();
  if (ffmpeg) {
    try {
      const res = await run(ffmpeg, ['-hide_banner', '-encoders'], 10_000);
      for (const line of res.stdout.toString().split('\n')) {
        const m = line.match(/^\s*[VAS][.\w]{5}\s+(\S+)/);
        if (m?.[1]) encoders.add(m[1]);
      }
    } catch {
      // ignore
    }
  }
  if (ffmpeg) log.info(`Using ffmpeg ${version} (${ffmpeg})${ffprobe ? `, ffprobe (${ffprobe})` : ', no ffprobe'}`);
  else log.warn('ffmpeg not found: direct play only, no thumbnails. Install ffmpeg or set FFMPEG_PATH.');
  return { ffmpeg, ffprobe, version, encoders };
}

// ---------------------------------------------------------------------------
// ffprobe
// ---------------------------------------------------------------------------

export interface FfprobeStream {
  index: number;
  codec_name?: string;
  codec_type?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  color_transfer?: string;
  channels?: number;
  tags?: Record<string, string>;
  disposition?: Record<string, number>;
}

export interface FfprobeResult {
  streams?: FfprobeStream[];
  format?: {
    format_name?: string;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
}

export async function ffprobeFile(ffprobe: string, file: string): Promise<FfprobeResult | null> {
  const res = await run(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    90_000,
  );
  if (res.code !== 0) {
    log.debug(`ffprobe failed for ${file}: ${res.stderr.trim().slice(0, 300)}`);
    return null;
  }
  try {
    return JSON.parse(res.stdout.toString()) as FfprobeResult;
  } catch {
    return null;
  }
}

/** Time (seconds) of the last video keyframe at or before `t`. Falls back to `t`. */
export async function keyframeBefore(ffprobe: string, file: string, t: number): Promise<number> {
  if (t <= 0) return 0;
  for (const window of [12, 40]) {
    const from = Math.max(0, t - window);
    try {
      const res = await run(
        ffprobe,
        [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-skip_frame', 'nokey',
          '-show_entries', 'frame=pts_time,best_effort_timestamp_time',
          '-of', 'csv=p=0',
          '-read_intervals', `${from.toFixed(3)}%${(t + 0.05).toFixed(3)}`,
          file,
        ],
        20_000,
      );
      const times = res.stdout
        .toString()
        .split(/\r?\n/)
        .flatMap((line) => line.split(','))
        .map((v) => Number.parseFloat(v))
        .filter((v) => Number.isFinite(v) && v <= t + 0.001);
      if (times.length > 0) return Math.max(...times);
    } catch {
      break;
    }
  }
  return t;
}

// ---------------------------------------------------------------------------
// Frames & subtitles
// ---------------------------------------------------------------------------

/** Grab one JPEG frame at `t` seconds. Returns the image bytes or null. */
export async function grabFrame(ffmpeg: string, file: string, t: number, width: number): Promise<Buffer | null> {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-ss', Math.max(0, t).toFixed(3),
    '-i', file,
    '-map', '0:v:0',
    '-frames:v', '1',
    '-vf', `scale=${width}:-2:flags=bicubic`,
    '-q:v', '4',
    '-f', 'image2', '-c:v', 'mjpeg',
    'pipe:1',
  ];
  try {
    const res = await run(ffmpeg, args, 45_000);
    if (res.code === 0 && res.stdout.length > 500) return res.stdout;
    log.debug(`Frame grab failed (${file} @${t}s): ${res.stderr.trim().slice(0, 200)}`);
  } catch (err) {
    log.debug('Frame grab error', err);
  }
  return null;
}

export async function grabFrameToFile(ffmpeg: string, file: string, t: number, width: number, out: string): Promise<boolean> {
  const buf = await grabFrame(ffmpeg, file, t, width);
  if (!buf) return false;
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, buf);
  return true;
}

/** Extract a text subtitle stream as WebVTT. */
export async function extractSubtitleVtt(ffmpeg: string, file: string, subStreamIndex: number): Promise<string | null> {
  const res = await run(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-map', `0:s:${subStreamIndex}`, '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1'],
    10 * 60_000,
  );
  if (res.code !== 0) {
    log.warn(`Subtitle extraction failed for ${file}: ${res.stderr.trim().slice(0, 200)}`);
    return null;
  }
  return res.stdout.toString('utf8');
}

// ---------------------------------------------------------------------------
// Live streaming (remux / transcode to fragmented MP4)
// ---------------------------------------------------------------------------

export interface StreamArgsOptions {
  input: string;
  start: number;
  mode: 'remux' | 'transcode';
  audioIndex: number | null;
  /** Copy the audio stream instead of re-encoding it to AAC. */
  copyAudio: boolean;
  /** Source video codec (for remux tagging). */
  videoCodec: string | null;
  sourceHeight: number | null;
  maxHeight: number;
  hwAccel: SettingsDTO['hwAccel'];
  encoders: Set<string>;
}

function videoEncoderArgs(opts: StreamArgsOptions): { pre: string[]; args: string[] } {
  const scaleNeeded = opts.sourceHeight !== null && opts.sourceHeight > opts.maxHeight;
  const gop = ['-g', '48', '-keyint_min', '48'];
  const hw = opts.hwAccel;
  if (hw === 'nvenc' && opts.encoders.has('h264_nvenc')) {
    return {
      pre: [],
      args: [
        ...(scaleNeeded ? ['-vf', `scale=-2:${opts.maxHeight}`] : []),
        '-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-pix_fmt', 'yuv420p', ...gop,
      ],
    };
  }
  if (hw === 'qsv' && opts.encoders.has('h264_qsv')) {
    return {
      pre: [],
      args: [
        ...(scaleNeeded ? ['-vf', `scale=-2:${opts.maxHeight}`] : []),
        '-c:v', 'h264_qsv', '-global_quality', '23', '-pix_fmt', 'nv12', ...gop,
      ],
    };
  }
  if (hw === 'vaapi' && opts.encoders.has('h264_vaapi')) {
    const scale = scaleNeeded ? `,scale_vaapi=w=-2:h=${opts.maxHeight}` : '';
    return {
      pre: ['-vaapi_device', process.env.VAAPI_DEVICE ?? '/dev/dri/renderD128'],
      args: ['-vf', `format=nv12,hwupload${scale}`, '-c:v', 'h264_vaapi', '-qp', '23', ...gop],
    };
  }
  if (hw === 'videotoolbox' && opts.encoders.has('h264_videotoolbox')) {
    return {
      pre: [],
      args: [
        ...(scaleNeeded ? ['-vf', `scale=-2:${opts.maxHeight}`] : []),
        '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p', ...gop,
      ],
    };
  }
  return {
    pre: [],
    args: [
      ...(scaleNeeded ? ['-vf', `scale=-2:${opts.maxHeight}:flags=bicubic`] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-maxrate', '12M', '-bufsize', '24M',
      '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...gop, '-sc_threshold', '0',
    ],
  };
}

export function buildStreamArgs(opts: StreamArgsOptions): string[] {
  const video = opts.mode === 'transcode' ? videoEncoderArgs(opts) : { pre: [], args: ['-c:v', 'copy'] };
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', ...video.pre];
  if (opts.start > 0) args.push('-ss', opts.start.toFixed(3));
  args.push('-i', opts.input, '-map', '0:v:0');
  if (opts.audioIndex !== null) args.push('-map', `0:a:${opts.audioIndex}?`);
  args.push(...video.args);
  if (opts.mode === 'remux' && (opts.videoCodec === 'hevc' || opts.videoCodec === 'h265')) args.push('-tag:v', 'hvc1');
  if (opts.audioIndex !== null) {
    if (opts.copyAudio) args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k');
  }
  args.push(
    '-sn', '-dn',
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-max_muxing_queue_size', '2048',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration', '2000000',
    '-f', 'mp4',
    'pipe:1',
  );
  return args;
}

export function spawnFfmpeg(ffmpeg: string, args: string[]): ChildProcess {
  return spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
