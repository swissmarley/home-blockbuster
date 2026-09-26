import { describe, expect, it } from 'vitest';
import { buildStreamArgs } from '../src/media/ffmpeg.js';
import { BASELINE_CAPS, decidePlayback, parseCaps, previewUrl } from '../src/media/playback.js';
import { parseRange } from '../src/media/stream.js';
import type { ProbeInfo, StoredFile } from '../src/types.js';

function file(ext: string, probe: Partial<ProbeInfo> | null): StoredFile {
  return {
    id: 'f1',
    libraryId: 'l1',
    path: `/media/movie.${ext}`,
    relPath: `movie.${ext}`,
    size: 1000,
    mtimeMs: 1,
    ext,
    titleId: 't1',
    parsed: {
      kind: 'movie',
      title: 'Movie',
      year: null,
      season: null,
      episode: null,
      episodeEnd: null,
      episodeTitle: null,
      airDate: null,
      imdbId: null,
      tmdbId: null,
      tvdbId: null,
      edition: null,
      resolution: null,
      part: null,
    },
    probe: probe
      ? {
          duration: 7200,
          container: ext,
          bitrate: null,
          video: { codec: 'h264', profile: 'High', width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8, hdr: false },
          audio: [{ index: 0, codec: 'aac', channels: 2, language: 'eng', title: null, default: true }],
          subtitles: [],
          source: 'ffprobe',
          ...probe,
        }
      : null,
    tags: null,
    cover: null,
    thumb: null,
    subtitles: [],
    addedAt: 0,
    updatedAt: 0,
  };
}

const chrome = parseCaps('h264,vp9,vp8,av1,aac,mp3,opus,vorbis,flac,webm');
const safari = parseCaps('h264,hevc,aac,mp3,ac3,eac3,flac');
const withFfmpeg = { ffmpeg: true, transcoding: true };

describe('parseCaps', () => {
  it('falls back to a baseline when the client sends nothing', () => {
    expect(parseCaps(undefined)).toBe(BASELINE_CAPS);
    expect(parseCaps('')).toBe(BASELINE_CAPS);
  });

  it('keeps known tokens only', () => {
    const caps = parseCaps('h264,hevc,bogus,ac3,mkv');
    expect([...caps.video]).toEqual(['h264', 'hevc']);
    expect([...caps.audio]).toEqual(['ac3']);
    expect(caps.containers.has('mkv')).toBe(true);
    expect(caps.containers.has('mp4')).toBe(true);
  });
});

describe('decidePlayback', () => {
  it('plays browser-friendly MP4 directly', () => {
    expect(decidePlayback(file('mp4', {}), chrome, withFfmpeg).mode).toBe('direct');
  });

  it('remuxes MKV with compatible codecs', () => {
    const d = decidePlayback(file('mkv', {}), chrome, withFfmpeg);
    expect(d.mode).toBe('remux');
    expect(d.copyAudio).toBe(true);
  });

  it('remuxes and converts audio the browser cannot decode (AC3 on Chrome)', () => {
    const f = file('mp4', { audio: [{ index: 0, codec: 'ac3', channels: 6, language: null, title: null, default: true }] });
    const d = decidePlayback(f, chrome, withFfmpeg);
    expect(d.mode).toBe('remux');
    expect(d.copyAudio).toBe(false);
    // Safari decodes AC3 itself.
    expect(decidePlayback(f, safari, withFfmpeg).mode).toBe('direct');
  });

  it('transcodes HEVC for browsers without HEVC support but not for Safari', () => {
    const f = file('mkv', { video: { codec: 'hevc', profile: 'Main 10', width: 3840, height: 2160, pixFmt: 'yuv420p10le', bitDepth: 10, hdr: true } });
    expect(decidePlayback(f, chrome, withFfmpeg).mode).toBe('transcode');
    expect(decidePlayback(f, safari, withFfmpeg).mode).toBe('remux');
  });

  it('transcodes 10-bit H.264 and legacy codecs', () => {
    const hi10 = file('mkv', { video: { codec: 'h264', profile: 'High 10', width: 1920, height: 1080, pixFmt: 'yuv420p10le', bitDepth: 10, hdr: false } });
    expect(decidePlayback(hi10, chrome, withFfmpeg).mode).toBe('transcode');
    const xvid = file('avi', { video: { codec: 'mpeg4', profile: null, width: 720, height: 400, pixFmt: 'yuv420p', bitDepth: 8, hdr: false } });
    expect(decidePlayback(xvid, chrome, withFfmpeg).mode).toBe('transcode');
  });

  it('switches to a stream to play a non-default audio track', () => {
    const f = file('mp4', {
      audio: [
        { index: 0, codec: 'aac', channels: 2, language: 'eng', title: null, default: true },
        { index: 1, codec: 'aac', channels: 2, language: 'ger', title: null, default: false },
      ],
    });
    expect(decidePlayback(f, chrome, withFfmpeg).mode).toBe('direct');
    const d = decidePlayback(f, chrome, { ...withFfmpeg, audioIndex: 1 });
    expect(d.mode).toBe('remux');
    expect(d.audioIndex).toBe(1);
  });

  it('falls back to direct play with a reason when ffmpeg is missing', () => {
    const d = decidePlayback(file('avi', { video: { codec: 'mpeg4', profile: null, width: 720, height: 400, pixFmt: 'yuv420p', bitDepth: 8, hdr: false } }), chrome, {
      ffmpeg: false,
      transcoding: true,
    });
    expect(d.mode).toBe('direct');
    expect(d.reason).toMatch(/ffmpeg/);
  });

  it('targets VP9/Opus for browsers without H.264/AAC (e.g. some Linux Chromium builds)', () => {
    const chromium = parseCaps('vp9,vp8,av1,opus,vorbis,flac,webm');
    const d = decidePlayback(file('mp4', {}), chromium, withFfmpeg);
    expect(d).toMatchObject({ mode: 'transcode', videoTarget: 'vp9', audioTarget: 'opus', copyAudio: false });
    expect(decidePlayback(file('mp4', {}), chrome, withFfmpeg)).toMatchObject({ videoTarget: 'h264', audioTarget: 'aac' });
    // VP9 video only needs the audio converted.
    const vp9 = file('mkv', { video: { codec: 'vp9', profile: null, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8, hdr: false } });
    expect(decidePlayback(vp9, chromium, withFfmpeg)).toMatchObject({ mode: 'remux', audioTarget: 'opus' });
  });

  it('forces a stream after a failed direct attempt', () => {
    expect(decidePlayback(file('mp4', {}), chrome, { ...withFfmpeg, forceStream: true }).mode).toBe('transcode');
    expect(decidePlayback(file('mp4', null), chrome, { ...withFfmpeg, forceStream: true }).mode).toBe('transcode');
  });
});

describe('previewUrl', () => {
  it('uses a media fragment for direct files and skips into the movie', () => {
    expect(previewUrl(file('mp4', {}), true)).toBe('/api/stream/f1#t=864');
  });

  it('uses an audio-less remux for MKV and nothing for full transcodes', () => {
    expect(previewUrl(file('mkv', {}), true)).toBe('/api/stream/f1/live?mode=remux&audio=-1&start=864&session=preview');
    expect(previewUrl(file('mkv', {}), false)).toBeNull();
    const hevc = file('mkv', { video: { codec: 'hevc', profile: null, width: 1920, height: 1080, pixFmt: 'yuv420p', bitDepth: 8, hdr: false } });
    expect(previewUrl(hevc, true)).toBeNull();
  });
});

describe('parseRange', () => {
  it('parses open, closed and suffix ranges', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('rejects unsatisfiable ranges', () => {
    expect(parseRange('bytes=1000-', 1000)).toBeNull();
    expect(parseRange('bytes=500-100', 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });
});

describe('buildStreamArgs', () => {
  const base = {
    input: '/media/a.mkv',
    start: 120.5,
    audioIndex: 1,
    copyAudio: false,
    videoCodec: 'h264',
    sourceHeight: 2160,
    maxHeight: 1080,
    hwAccel: 'none' as const,
    encoders: new Set<string>(),
  };

  it('copies video when remuxing and seeks before the input', () => {
    const args = buildStreamArgs({ ...base, mode: 'remux' });
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args).toContain('copy');
    expect(args.join(' ')).toContain('-map 0:a:1?');
    expect(args.join(' ')).toContain('-c:a aac -ac 2');
    expect(args.join(' ')).toContain('frag_keyframe+empty_moov+default_base_moof');
    expect(args.at(-1)).toBe('pipe:1');
  });

  it('re-encodes and downscales when transcoding', () => {
    const args = buildStreamArgs({ ...base, mode: 'transcode' }).join(' ');
    expect(args).toContain('-c:v libx264');
    expect(args).toContain('scale=-2:1080');
  });

  it('uses a hardware encoder only when ffmpeg has it', () => {
    expect(buildStreamArgs({ ...base, mode: 'transcode', hwAccel: 'nvenc' }).join(' ')).toContain('libx264');
    expect(buildStreamArgs({ ...base, mode: 'transcode', hwAccel: 'nvenc', encoders: new Set(['h264_nvenc']) }).join(' ')).toContain('h264_nvenc');
  });

  it('encodes VP9 and Opus when asked to', () => {
    const args = buildStreamArgs({ ...base, mode: 'transcode', videoTarget: 'vp9', audioTarget: 'opus' }).join(' ');
    expect(args).toContain('-c:v libvpx-vp9');
    expect(args).toContain('-c:a libopus');
    expect(args).not.toContain('libx264');
  });

  it('omits audio for silent previews and tags HEVC for Safari', () => {
    const args = buildStreamArgs({ ...base, mode: 'remux', audioIndex: null, videoCodec: 'hevc' }).join(' ');
    expect(args).not.toContain('0:a');
    expect(args).toContain('-tag:v hvc1');
  });
});
