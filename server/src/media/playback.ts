import type { PlaybackMode } from '../shared/types.js';
import type { ProbeAudio, ProbeVideo, StoredFile } from '../types.js';

export interface ClientCaps {
  video: Set<string>;
  audio: Set<string>;
  containers: Set<string>;
}

/** What essentially every modern desktop browser can play. Used when the client doesn't say. */
export const BASELINE_CAPS: ClientCaps = {
  video: new Set(['h264', 'vp8', 'vp9']),
  audio: new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']),
  containers: new Set(['mp4', 'm4v', 'mov', 'webm']),
};

const KNOWN_VIDEO = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1']);
const KNOWN_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', 'ac3', 'eac3']);
const KNOWN_CONTAINERS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv']);

/** Parse `caps=h264,hevc,aac,ac3,mkv` sent by the client (from canPlayType checks). */
export function parseCaps(raw: unknown): ClientCaps {
  if (typeof raw !== 'string' || !raw.trim()) return BASELINE_CAPS;
  const tokens = raw.toLowerCase().split(',').map((t) => t.trim());
  const caps: ClientCaps = { video: new Set(), audio: new Set(), containers: new Set(['mp4', 'm4v', 'mov']) };
  for (const token of tokens) {
    if (KNOWN_VIDEO.has(token)) caps.video.add(token);
    if (KNOWN_AUDIO.has(token)) caps.audio.add(token);
    if (KNOWN_CONTAINERS.has(token)) caps.containers.add(token);
  }
  if (caps.video.size === 0) caps.video = new Set(BASELINE_CAPS.video);
  if (caps.audio.size === 0) caps.audio = new Set(BASELINE_CAPS.audio);
  return caps;
}

export function videoCompatible(v: ProbeVideo, caps: ClientCaps): boolean {
  switch (v.codec) {
    case 'h264': {
      if (!caps.video.has('h264')) return false;
      if ((v.bitDepth ?? 8) > 8) return false; // Hi10P is not decodable by browsers
      if (/high 10|high 4:2:2|high 4:4:4/i.test(v.profile ?? '')) return false;
      return !v.pixFmt || /^(yuv420p|yuvj420p|nv12)$/.test(v.pixFmt);
    }
    case 'hevc':
    case 'vp8':
    case 'vp9':
    case 'av1':
      return caps.video.has(v.codec);
    default:
      return false;
  }
}

export function audioCompatible(a: ProbeAudio | undefined, caps: ClientCaps): boolean {
  if (!a) return true;
  return caps.audio.has(a.codec);
}

/** Codecs that can be copied into a fragmented MP4 without re-encoding. */
const MP4_VIDEO = new Set(['h264', 'hevc', 'vp9', 'av1']);
const MP4_AUDIO = new Set(['aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3']);

/** The audio stream a browser will pick when playing the file directly. */
export function browserAudioIndex(audio: ProbeAudio[]): number {
  const def = audio.find((a) => a.default);
  return def ? def.index : 0;
}

export interface PlaybackDecision {
  mode: PlaybackMode;
  audioIndex: number | null;
  copyAudio: boolean;
  reason: string | null;
}

export function decidePlayback(
  file: StoredFile,
  caps: ClientCaps,
  opts: { ffmpeg: boolean; transcoding: boolean; audioIndex?: number | null; forceStream?: boolean },
): PlaybackDecision {
  const probe = file.probe;
  const canStream = opts.ffmpeg && opts.transcoding;
  if (!probe) {
    // Unknown file: try the browser, fall back to a full transcode if the client reports an error.
    return { mode: opts.forceStream && canStream ? 'transcode' : 'direct', audioIndex: null, copyAudio: false, reason: null };
  }
  const audioCount = probe.audio.length;
  const wanted = opts.audioIndex ?? null;
  const audioIndex = audioCount === 0 ? null : wanted !== null && wanted >= 0 && wanted < audioCount ? wanted : browserAudioIndex(probe.audio);
  const audio = audioIndex === null ? undefined : probe.audio[audioIndex];
  const videoOk = !probe.video || videoCompatible(probe.video, caps);
  const audioOk = audioCompatible(audio, caps);
  const containerOk = caps.containers.has(file.ext);
  const audioSwitch = audioIndex !== null && audioIndex !== browserAudioIndex(probe.audio);

  if (videoOk && audioOk && containerOk && !audioSwitch && !opts.forceStream) {
    return { mode: 'direct', audioIndex, copyAudio: true, reason: null };
  }
  if (!canStream) {
    const reason = !opts.ffmpeg
      ? 'This file may not play in your browser. Install ffmpeg on the server to enable transcoding.'
      : 'This file may not play in your browser. Enable transcoding in Settings.';
    return { mode: 'direct', audioIndex, copyAudio: true, reason: videoOk && audioOk ? null : reason };
  }
  const copyAudio = audio !== undefined && audioOk && MP4_AUDIO.has(audio.codec);
  if (probe.video && videoOk && MP4_VIDEO.has(probe.video.codec) && !opts.forceStream) {
    return { mode: 'remux', audioIndex, copyAudio, reason: null };
  }
  if (!probe.video) return { mode: 'remux', audioIndex, copyAudio, reason: null };
  return { mode: 'transcode', audioIndex, copyAudio: copyAudio && audio?.codec === 'aac', reason: null };
}

/**
 * URL of a muted autoplay preview (billboard / hover card), or null when it would need a full video
 * re-encode. Starts a little into the video to skip studio logos and opening credits.
 */
export function previewUrl(file: StoredFile | undefined, ffmpeg: boolean): string | null {
  if (!file) return null;
  const probe = file.probe;
  const duration = probe?.duration ?? 0;
  const start = duration >= 600 ? Math.round(duration * 0.12) : 0;
  const direct = `/api/stream/${file.id}${start ? `#t=${start}` : ''}`;
  if (!probe) return ['mp4', 'm4v', 'webm'].includes(file.ext) ? direct : null;
  if (!probe.video || !videoCompatible(probe.video, BASELINE_CAPS)) return null;
  const audio = probe.audio[browserAudioIndex(probe.audio)];
  if (BASELINE_CAPS.containers.has(file.ext) && audioCompatible(audio, BASELINE_CAPS)) return direct;
  return ffmpeg ? `/api/stream/${file.id}/live?mode=remux&audio=-1&start=${start}&session=preview` : null;
}
