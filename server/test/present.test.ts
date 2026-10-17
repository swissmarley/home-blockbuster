import { describe, expect, it } from 'vitest';
import { episodeFor, movieEntries, nextFileFor, playFileFor, titleDetail } from '../src/library/present.js';
import { newTitle } from '../src/library/repository.js';
import type { ParsedName, StoredFile } from '../src/types.js';

function file(id: string, relPath: string, opts: { parsed?: Partial<ParsedName>; duration?: number; height?: number; libraryId?: string } = {}): StoredFile {
  return {
    id,
    libraryId: opts.libraryId ?? 'lib',
    path: `/media/${relPath}`,
    relPath,
    size: 1000 + (opts.height ?? 0),
    mtimeMs: 0,
    ext: 'mp4',
    titleId: 't',
    parsed: {
      kind: 'movie',
      title: 'Vacation',
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
      ...opts.parsed,
    },
    probe:
      opts.duration === undefined
        ? null
        : {
            duration: opts.duration,
            container: 'mp4',
            bitrate: null,
            video: { codec: 'h264', profile: null, width: 0, height: opts.height ?? 720, pixFmt: null, bitDepth: null, hdr: false },
            audio: [],
            subtitles: [],
            source: 'ffprobe',
          },
    tags: null,
    cover: null,
    thumb: null,
    subtitles: [],
    addedAt: 0,
    updatedAt: 0,
  };
}

const title = newTitle('movie', 'Vacation', null, 't');
const ctx = { onlineLibraries: new Set(['lib']), ffmpeg: false };

describe('movie series', () => {
  it('treats copies of one video as versions, not episodes', () => {
    const files = [file('sd', 'Vacation.mp4', { duration: 600, height: 480 }), file('hd', 'HD/Vacation.mp4', { duration: 601, height: 1080 })];
    const entries = movieEntries(files);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.best.id).toBe('hd');
    expect(episodeFor(title, files, files[0]!)).toBeNull();
    expect(titleDetail(title, files, [title], ctx).seasons).toEqual([]);
  });

  it('lists parts, editions and same-name videos of different length as episodes in order', () => {
    const files = [
      file('p2', 'Vacation Part 2.mp4', { parsed: { part: 2 }, duration: 500 }),
      file('p1', 'Vacation Part 1.mp4', { parsed: { part: 1 }, duration: 700 }),
      file('p1-hd', 'HD/Vacation Part 1.mp4', { parsed: { part: 1 }, duration: 700, height: 1080 }),
    ];
    const entries = movieEntries(files);
    expect(entries.map((e) => e.best.id)).toEqual(['p1-hd', 'p2']);
    expect(playFileFor(title, files)?.id).toBe('p1-hd');

    const detail = titleDetail(title, files, [title], ctx);
    expect(detail.seasons).toHaveLength(1);
    expect(detail.seasons[0]!.episodes.map((e) => [e.episode, e.name, e.fileId])).toEqual([
      [1, 'Part 1', 'p1-hd'],
      [2, 'Part 2', 'p2'],
    ]);
    expect(detail.episodeCount).toBe(2);

    const clips = [file('a', 'Birthday.mp4', { duration: 300 }), file('b', 'Party/Birthday.mp4', { duration: 420 })];
    expect(movieEntries(clips)).toHaveLength(2);

    const cuts = [file('th', 'Vacation.mp4', { duration: 6000 }), file('ex', 'Vacation Extended.mp4', { parsed: { edition: 'Extended' }, duration: 6900 })];
    expect(titleDetail(title, cuts, [title], ctx).seasons[0]!.episodes.map((e) => e.name)).toEqual(['Vacation', 'Extended']);
  });

  it('plays the next video of the series, from any version of the current one', () => {
    const files = [
      file('johnny', 'We gonna walk with Johnny.mp4', { parsed: { episodeTitle: 'We gonna walk with Johnny' } }),
      file('mary', 'We gonna walk with Mary.mp4', { parsed: { episodeTitle: 'We gonna walk with Mary' } }),
      file('mary-copy', 'Backup/We gonna walk with Mary.mp4', { parsed: { episodeTitle: 'We gonna walk with Mary' }, libraryId: 'offline' }),
    ];
    const online = new Set(['lib']);
    expect(nextFileFor(title, files, 'johnny', online)?.id).toBe('mary');
    expect(nextFileFor(title, files, 'mary', online)).toBeNull();
    expect(nextFileFor(title, files, 'mary-copy', online)).toBeNull();
    expect(episodeFor(title, files, files[2]!, online)).toMatchObject({ fileId: 'mary-copy', episode: 2, name: 'We gonna walk with Mary' });
  });
});
