import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { episodeDTO, nextEpisodeFile, subtitleTracks, titleSummary } from '../library/present.js';
import { decodeSubtitleBuffer, languageInfo, parseSubtitles } from '../library/subtitles.js';
import { extractSubtitleVtt, grabFrame, keyframeBefore, type StreamArgsOptions } from '../media/ffmpeg.js';
import { browserAudioIndex, decidePlayback, parseCaps } from '../media/playback.js';
import { contentTypeFor, sendFileWithRanges } from '../media/stream.js';
import type { Services } from '../services.js';
import type { AudioTrack, PlaybackInfo, SubtitleCue } from '../shared/types.js';
import type { ProbeAudio, StoredFile } from '../types.js';
import { Semaphore } from '../util/concurrency.js';
import { ApiError, notFound, param, queryNumber, queryString } from './util.js';
import { isKidFriendly, profileFromRequest } from './titles.js';

function channelLabel(channels: number | null): string | null {
  if (!channels) return null;
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels} ch`;
}

function audioTracks(audio: ProbeAudio[]): AudioTrack[] {
  const defaultIndex = browserAudioIndex(audio);
  return audio.map((a) => {
    const lang = languageInfo(a.language);
    const base = lang.name ?? a.title ?? (audio.length === 1 ? 'Original' : `Track ${a.index + 1}`);
    const extra = [channelLabel(a.channels), a.title && lang.name && !a.title.toLowerCase().includes(lang.name.toLowerCase()) ? a.title : null]
      .filter(Boolean)
      .join(' · ');
    return {
      index: a.index,
      label: extra ? `${base} (${extra})` : base,
      language: lang.code,
      codec: a.codec,
      channels: a.channels,
      default: a.index === defaultIndex,
    };
  });
}

/** Small LRU for parsed subtitle cues. */
class CueCache {
  private readonly map = new Map<string, SubtitleCue[]>();
  constructor(private readonly max = 24) {}
  get(key: string): SubtitleCue[] | undefined {
    const value = this.map.get(key);
    if (value) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }
  set(key: string, value: SubtitleCue[]): void {
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
}

export function playbackRoutes(services: Services): Router {
  const router = Router();
  const { repo, ffmpeg, cacheDir } = services;
  const frameSem = new Semaphore(2);
  const cues = new CueCache();
  const extracting = new Map<string, Promise<string | null>>();

  const fileOr404 = (id: string): StoredFile => {
    const file = repo.file(id);
    if (!file) throw notFound('File');
    return file;
  };

  /** The file's real path, or 404 when it is gone or a symlink now points outside the libraries. */
  const mediaPath = async (file: StoredFile): Promise<string> => {
    const real = await services.guard.resolve(file.path);
    if (!real) throw new ApiError(404, 'The video file is not reachable. Is the drive or network share connected?');
    return real;
  };

  router.get('/playback/:fileId', (req, res) => {
    const file = fileOr404(param(req, 'fileId'));
    const title = repo.title(file.titleId);
    if (!title) throw notFound('Title');
    const settings = services.settings();
    const audioParam = queryNumber(req, 'audio');
    const decision = decidePlayback(file, parseCaps(req.query.caps), {
      ffmpeg: Boolean(services.streams),
      transcoding: settings.transcoding,
      audioIndex: audioParam ?? null,
      forceStream: req.query.force === '1',
    });
    const files = repo.filesOf(title.id);
    const profile = profileFromRequest(services, req);
    const summary = titleSummary(title, files, services.present());
    if (profile?.kids && !isKidFriendly(summary)) throw new ApiError(403, 'This title is not available on a Kids profile.');
    const progress = profile?.state.progress[file.id];
    const duration = file.probe?.duration ?? progress?.duration ?? null;
    let resumeAt = 0;
    if (progress && !progress.finished && progress.position > 15 && (!duration || progress.position < duration - 20)) {
      resumeAt = progress.position;
    }
    const next = title.kind === 'show' ? nextEpisodeFile(files, file.id) : null;
    const url =
      decision.mode === 'direct'
        ? `/api/stream/${file.id}`
        : `/api/stream/${file.id}/live?mode=${decision.mode}&audio=${decision.audioIndex ?? -1}&copyAudio=${decision.copyAudio ? 1 : 0}` +
          `&v=${decision.videoTarget}&a=${decision.audioTarget}`;
    const info: PlaybackInfo = {
      fileId: file.id,
      titleId: title.id,
      title: summary,
      episode: title.kind === 'show' ? episodeDTO(title, file) : null,
      next: next ? episodeDTO(title, next) : null,
      mode: decision.mode,
      url,
      canTranscode: Boolean(services.streams) && settings.transcoding,
      duration,
      subtitles: subtitleTracks(file.subtitles),
      audioTracks: audioTracks(file.probe?.audio ?? []),
      resumeAt,
      hasFrames: Boolean(ffmpeg.ffmpeg),
      reason: decision.reason,
    };
    res.json(info);
  });

  router.get('/stream/:fileId', async (req, res) => {
    const file = fileOr404(param(req, 'fileId'));
    await sendFileWithRanges(req, res, await mediaPath(file), contentTypeFor(file.ext));
  });

  router.get('/stream/:fileId/live', async (req, res) => {
    const streams = services.streams;
    if (!streams) throw new ApiError(503, 'Transcoding requires ffmpeg on the server.');
    const file = fileOr404(param(req, 'fileId'));
    const input = await mediaPath(file);
    const probe = file.probe;
    const duration = probe?.duration ?? Number.POSITIVE_INFINITY;
    const start = Math.min(Math.max(0, queryNumber(req, 'start') ?? 0), Math.max(0, duration - 1));
    const audioCount = probe?.audio.length ?? 1;
    const requested = queryNumber(req, 'audio');
    let audioIndex: number | null;
    if (requested === -1) audioIndex = null;
    else if (requested !== undefined && requested >= 0 && requested < audioCount) audioIndex = requested;
    else audioIndex = audioCount > 0 ? browserAudioIndex(probe?.audio ?? []) : null;
    const settings = services.settings();
    // Keyed by client address too, so one device's previews or seeks never replace another device's stream.
    const owner = req.ip ?? 'anon';
    const session = (queryString(req, 'session') ?? 'main').slice(0, 64);
    const opts: StreamArgsOptions = {
      input,
      start,
      mode: req.query.mode === 'transcode' ? 'transcode' : 'remux',
      audioIndex,
      copyAudio: req.query.copyAudio === '1',
      videoCodec: probe?.video?.codec ?? null,
      sourceHeight: probe?.video?.height ?? null,
      maxHeight: Math.min(2160, Math.max(240, queryNumber(req, 'maxh') ?? 1080)),
      hwAccel: settings.hwAccel,
      encoders: ffmpeg.encoders,
      videoTarget: req.query.v === 'vp9' ? 'vp9' : 'h264',
      audioTarget: req.query.a === 'opus' ? 'opus' : 'aac',
    };
    streams.stream(req, res, `${owner}|${session}:${file.id}`, opts, { owner, preview: session === 'preview' });
  });

  /** Remuxed streams can only start on a keyframe; the player asks where the nearest one is. */
  router.get('/stream/:fileId/keyframe', async (req, res) => {
    const file = fileOr404(param(req, 'fileId'));
    const t = Math.max(0, queryNumber(req, 't') ?? 0);
    const at = ffmpeg.ffprobe ? await keyframeBefore(ffmpeg.ffprobe, await mediaPath(file), t) : t;
    res.json({ t: at });
  });

  /** Scrubber preview thumbnails, snapped to 10 s and cached on disk. */
  router.get('/files/:fileId/frame', async (req, res) => {
    const file = fileOr404(param(req, 'fileId'));
    if (!ffmpeg.ffmpeg) throw new ApiError(404, 'Frame previews require ffmpeg.');
    const duration = file.probe?.duration ?? 0;
    const raw = Math.max(0, queryNumber(req, 't') ?? 0);
    const t = Math.min(Math.round(raw / 10) * 10, Math.max(0, Math.floor(duration) - 1));
    const out = path.join(cacheDir, 'frames', file.id, `${t}.jpg`);
    try {
      await fs.access(out);
    } catch {
      const input = await mediaPath(file);
      const buf = await frameSem.run(() => grabFrame(ffmpeg.ffmpeg!, input, t, 320));
      if (!buf) throw new ApiError(404, 'No frame');
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, buf);
    }
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.type('image/jpeg').sendFile(out);
  });

  router.get('/subtitles/:fileId/:subId', async (req, res) => {
    const file = fileOr404(param(req, 'fileId'));
    const sub = file.subtitles.find((s) => s.id === param(req, 'subId'));
    if (!sub) throw notFound('Subtitle');
    const key = `${file.id}:${sub.id}:${file.mtimeMs}`;
    const cached = cues.get(key);
    if (cached) {
      res.json({ cues: cached });
      return;
    }
    let parsed: SubtitleCue[];
    if (sub.source === 'sidecar' && sub.path && sub.format !== 'embedded') {
      let buf: Buffer;
      try {
        const real = await services.guard.resolve(sub.path);
        if (!real) throw notFound('Subtitle file');
        const st = await fs.stat(real);
        if (st.size > 15 * 1024 * 1024) throw new ApiError(413, 'Subtitle file is too large');
        buf = await fs.readFile(real);
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw notFound('Subtitle file');
      }
      parsed = parseSubtitles(decodeSubtitleBuffer(buf), sub.format);
    } else {
      if (!ffmpeg.ffmpeg || sub.streamIndex === undefined) throw new ApiError(404, 'Embedded subtitles require ffmpeg.');
      const vttPath = path.join(cacheDir, 'subs', `${file.id}-${sub.streamIndex}-${Math.floor(file.mtimeMs)}.vtt`);
      let vtt: string | null = null;
      try {
        vtt = await fs.readFile(vttPath, 'utf8');
      } catch {
        let pending = extracting.get(vttPath);
        if (!pending) {
          const input = await mediaPath(file);
          pending = extractSubtitleVtt(ffmpeg.ffmpeg, input, sub.streamIndex).then(async (text) => {
            if (text) {
              await fs.mkdir(path.dirname(vttPath), { recursive: true });
              await fs.writeFile(vttPath, text, 'utf8');
            }
            return text;
          });
          pending.finally(() => extracting.delete(vttPath)).catch(() => undefined);
          extracting.set(vttPath, pending);
        }
        vtt = await pending;
      }
      if (!vtt) throw new ApiError(500, 'Could not extract subtitles');
      parsed = parseSubtitles(vtt, 'vtt');
    }
    cues.set(key, parsed);
    res.json({ cues: parsed });
  });

  return router;
}
