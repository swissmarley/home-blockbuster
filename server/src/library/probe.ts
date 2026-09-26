import path from 'node:path';
import { parseFile, type IAudioMetadata } from 'music-metadata';
import { ffprobeFile, type FfprobeResult } from '../media/ffmpeg.js';
import type { EmbeddedTags, ProbeAudio, ProbeInfo, ProbeSubtitle, ProbeVideo } from '../types.js';
import { createLogger } from '../util/log.js';

const log = createLogger('probe');

export interface ProbeOutput {
  probe: ProbeInfo | null;
  tags: EmbeddedTags | null;
  cover: { data: Uint8Array; mime: string } | null;
}

/** Containers whose tag formats music-metadata understands without scanning the whole file. */
const TAGGED_CONTAINERS = new Set(['mp4', 'm4v', 'mov', '3gp', 'mkv', 'webm', 'wmv', 'asf', 'ogv']);

const VIDEO_CODECS: Array<[RegExp, string]> = [
  [/avc|h\.?264/i, 'h264'],
  [/hevc|hvc1|hev1|h\.?265/i, 'hevc'],
  [/vp0?9/i, 'vp9'],
  [/vp0?8/i, 'vp8'],
  [/av0?1/i, 'av1'],
  [/mp4v|mpeg4\/iso\/(asp|sp)|divx|xvid/i, 'mpeg4'],
  [/mpeg2|mpg2/i, 'mpeg2video'],
  [/theora/i, 'theora'],
  [/wmv|vc-?1/i, 'vc1'],
];

const AUDIO_CODECS: Array<[RegExp, string]> = [
  [/e-?ac-?3|ec-3/i, 'eac3'],
  [/ac-?3/i, 'ac3'],
  [/aac|mp4a/i, 'aac'],
  [/truehd|mlp/i, 'truehd'],
  [/dts/i, 'dts'],
  [/opus/i, 'opus'],
  [/vorbis/i, 'vorbis'],
  [/flac/i, 'flac'],
  [/mpeg\/l3|mp3|layer 3|mpeg 1 layer 3/i, 'mp3'],
  [/mpeg\/l2|mp2/i, 'mp2'],
  [/pcm|lpcm|twos|sowt/i, 'pcm_s16le'],
  [/wma/i, 'wmav2'],
];

const SUBTITLE_CODECS: Array<[RegExp, string]> = [
  [/S_TEXT\/UTF8|subrip|srt/i, 'subrip'],
  [/S_TEXT\/ASS|\bass\b/i, 'ass'],
  [/S_TEXT\/SSA|\bssa\b/i, 'ssa'],
  [/webvtt/i, 'webvtt'],
  [/tx3g|mov_text/i, 'mov_text'],
  [/pgs/i, 'hdmv_pgs_subtitle'],
  [/vobsub/i, 'dvd_subtitle'],
];

function mapCodec(table: Array<[RegExp, string]>, name: string | undefined): string | null {
  if (!name) return null;
  const clean = name.replace(/[<>]/g, '');
  for (const [re, codec] of table) if (re.test(clean)) return codec;
  return clean.toLowerCase();
}

const cleanLang = (lang: string | undefined): string | null => (lang && lang !== 'und' ? lang : null);

// ---------------------------------------------------------------------------
// music-metadata
// ---------------------------------------------------------------------------

function probeFromMusicMetadata(meta: IAudioMetadata, ext: string): ProbeInfo {
  let video: ProbeVideo | null = null;
  const audio: ProbeAudio[] = [];
  const subtitles: ProbeSubtitle[] = [];
  for (const track of meta.format.trackInfo ?? []) {
    const name = track.codecName ?? '';
    const isSubtitle = track.type === 17 || /^S_|tx3g/i.test(name);
    const isAudio = !isSubtitle && (track.type === 2 || Boolean(track.audio));
    const isVideo = !isSubtitle && !isAudio && (track.type === 1 || Boolean(track.video) || VIDEO_CODECS.some(([re]) => re.test(name)));
    if (isVideo && !video) {
      video = {
        codec: mapCodec(VIDEO_CODECS, name) ?? 'unknown',
        profile: null,
        width: track.video?.pixelWidth ?? 0,
        height: track.video?.pixelHeight ?? 0,
        pixFmt: null,
        bitDepth: null,
        hdr: false,
      };
    } else if (isAudio) {
      audio.push({
        index: audio.length,
        codec: mapCodec(AUDIO_CODECS, name) ?? 'unknown',
        channels: track.audio?.channels ?? null,
        language: cleanLang(track.language),
        title: track.name ?? null,
        default: Boolean(track.flagDefault),
      });
    } else if (isSubtitle) {
      subtitles.push({
        index: subtitles.length,
        codec: mapCodec(SUBTITLE_CODECS, name) ?? 'unknown',
        language: cleanLang(track.language),
        title: track.name ?? null,
        forced: false,
        default: Boolean(track.flagDefault),
      });
    }
  }
  if (audio.length === 0 && meta.format.hasAudio && meta.format.codec) {
    audio.push({
      index: 0,
      codec: mapCodec(AUDIO_CODECS, meta.format.codec) ?? 'unknown',
      channels: meta.format.numberOfChannels ?? null,
      language: null,
      title: null,
      default: true,
    });
  }
  return {
    duration: meta.format.duration ?? null,
    container: ext,
    bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate) : null,
    video,
    audio,
    subtitles,
    source: 'music-metadata',
  };
}

function tagsFromMusicMetadata(meta: IAudioMetadata): EmbeddedTags {
  const c = meta.common;
  const comment = c.comment?.map((x) => x.text).find((t): t is string => Boolean(t?.trim()));
  const tags: EmbeddedTags = {
    title: c.title,
    year: c.year,
    date: c.date ?? c.releasedate,
    genres: c.genre?.filter(Boolean),
    description: c.longDescription ?? c.description?.[0],
    show: c.tvShow,
    season: c.tvSeason,
    episode: c.tvEpisode,
    episodeId: c.tvEpisodeId,
    network: c.tvNetwork,
    artist: c.artist,
    comment,
  };
  return tags;
}

function pickCover(meta: IAudioMetadata): ProbeOutput['cover'] {
  const pictures = (meta.common.picture ?? []).filter((p) => p.format?.startsWith('image/') && p.data?.length > 1000);
  if (pictures.length === 0) return null;
  const score = (p: (typeof pictures)[number]): number => {
    const name = (p.name ?? '').toLowerCase();
    if (/^cover\.(jpe?g|png|webp)$/.test(name)) return 3;
    if (p.type === 'Cover (front)') return 2;
    if (name.includes('cover') && !name.includes('small') && !name.includes('land')) return 1;
    return 0;
  };
  const best = [...pictures].sort((a, b) => score(b) - score(a))[0]!;
  return { data: best.data, mime: best.format };
}

// ---------------------------------------------------------------------------
// ffprobe
// ---------------------------------------------------------------------------

function probeFromFfprobe(res: FfprobeResult, ext: string): ProbeInfo {
  const streams = res.streams ?? [];
  let video: ProbeVideo | null = null;
  const audio: ProbeAudio[] = [];
  const subtitles: ProbeSubtitle[] = [];
  for (const s of streams) {
    if (s.codec_type === 'video') {
      const isCover = s.disposition?.attached_pic === 1 || s.codec_name === 'mjpeg' || s.codec_name === 'png';
      if (isCover || video) continue;
      const pixFmt = s.pix_fmt ?? null;
      const depthMatch = pixFmt?.match(/p(\d{2})(le|be)?$/);
      const bitDepth = depthMatch ? Number(depthMatch[1]) : Number(s.bits_per_raw_sample) || 8;
      video = {
        codec: s.codec_name ?? 'unknown',
        profile: s.profile ?? null,
        width: s.width ?? 0,
        height: s.height ?? 0,
        pixFmt,
        bitDepth,
        hdr: s.color_transfer === 'smpte2084' || s.color_transfer === 'arib-std-b67',
      };
    } else if (s.codec_type === 'audio') {
      audio.push({
        index: audio.length,
        codec: s.codec_name ?? 'unknown',
        channels: s.channels ?? null,
        language: cleanLang(s.tags?.language),
        title: s.tags?.title ?? null,
        default: s.disposition?.default === 1,
      });
    } else if (s.codec_type === 'subtitle') {
      subtitles.push({
        index: subtitles.length,
        codec: s.codec_name ?? 'unknown',
        language: cleanLang(s.tags?.language),
        title: s.tags?.title ?? null,
        forced: s.disposition?.forced === 1,
        default: s.disposition?.default === 1,
      });
    }
  }
  const duration = Number.parseFloat(res.format?.duration ?? '');
  const bitrate = Number.parseInt(res.format?.bit_rate ?? '', 10);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    container: ext,
    bitrate: Number.isFinite(bitrate) ? bitrate : null,
    video,
    audio,
    subtitles,
    source: 'ffprobe',
  };
}

function tagsFromFfprobe(res: FfprobeResult): EmbeddedTags {
  const raw = res.format?.tags ?? {};
  const t: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) t[k.toLowerCase()] = v;
  const int = (v: string | undefined): number | undefined => {
    const n = Number.parseInt(v ?? '', 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const date = t.date ?? t.date_released ?? t.year ?? t.creation_time?.slice(0, 10);
  const year = int(date?.match(/\b(19|20)\d{2}\b/)?.[0]);
  return {
    title: t.title,
    year,
    date,
    genres: t.genre ? t.genre.split(/[;/,]/).map((g) => g.trim()).filter(Boolean) : undefined,
    description: t.description ?? t.synopsis ?? t.summary,
    show: t.show,
    season: int(t.season_number),
    episode: int(t.episode_sort ?? t.episode_number),
    episodeId: t.episode_id,
    network: t.network,
    artist: t.artist,
    comment: t.comment,
    imdbId: t.imdb ?? t.imdb_id,
  };
}

function mergeTags(primary: EmbeddedTags, secondary: EmbeddedTags): EmbeddedTags {
  const merged: EmbeddedTags = { ...secondary };
  for (const [key, value] of Object.entries(primary) as Array<[keyof EmbeddedTags, unknown]>) {
    if (value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function finalizeTags(tags: EmbeddedTags): EmbeddedTags | null {
  const out: EmbeddedTags = {};
  for (const [key, value] of Object.entries(tags) as Array<[keyof EmbeddedTags, unknown]>) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) (out as Record<string, unknown>)[key] = trimmed;
    } else if (Array.isArray(value)) {
      if (value.length) (out as Record<string, unknown>)[key] = value;
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  if (!out.imdbId) {
    const haystack = [out.comment, out.description].filter(Boolean).join(' ');
    const imdb = haystack.match(/\btt\d{7,8}\b/)?.[0];
    if (imdb) out.imdbId = imdb;
  }
  return Object.keys(out).length ? out : null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Read technical stream info, embedded tags (ID3 / MP4 atoms / Matroska tags) and cover art. */
export async function probeMedia(file: string, ffprobe: string | null): Promise<ProbeOutput> {
  const ext = path.extname(file).slice(1).toLowerCase();
  let meta: IAudioMetadata | null = null;
  if (TAGGED_CONTAINERS.has(ext)) {
    try {
      meta = await withTimeout(parseFile(file, { duration: false, skipCovers: false, mkvUseIndex: true }), 60_000);
    } catch (err) {
      log.debug(`music-metadata could not parse ${file}`, err);
    }
  }
  let ff: FfprobeResult | null = null;
  if (ffprobe) {
    try {
      ff = await ffprobeFile(ffprobe, file);
    } catch (err) {
      log.debug(`ffprobe error for ${file}`, err);
    }
  }

  let probe: ProbeInfo | null = null;
  if (ff?.streams?.length) probe = probeFromFfprobe(ff, ext);
  else if (meta) probe = probeFromMusicMetadata(meta, ext);
  if (probe && !probe.duration && meta?.format.duration) probe.duration = meta.format.duration;

  const mmTags = meta ? tagsFromMusicMetadata(meta) : {};
  const ffTags = ff ? tagsFromFfprobe(ff) : {};
  const tags = finalizeTags(mergeTags(mmTags, ffTags));
  const cover = meta ? pickCover(meta) : null;
  return { probe, tags, cover };
}

export const __test = { probeFromFfprobe, probeFromMusicMetadata, tagsFromFfprobe, mapCodec, VIDEO_CODECS, AUDIO_CODECS };
