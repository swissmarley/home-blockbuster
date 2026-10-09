import { promises as fs } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { isAllowedHost } from '../src/routes/auth.js';
import { isKidFriendly } from '../src/routes/titles.js';
import { createServices, type Services } from '../src/services.js';
import type { ContinueItem, LibraryDTO, PlaybackInfo, ProfileDTO, ProfileState, TitleDetail, TitleSummary } from '../src/shared/types.js';
import type { FetchJson } from '../src/types.js';

// A tiny TMDB stand-in: just enough of the real response shapes for the scan -> match -> API flow.
const TMDB: Record<string, unknown> = {
  'search/movie:the matrix': { results: [{ id: 603, title: 'The Matrix', original_title: 'The Matrix', release_date: '1999-03-30', overview: 'A hacker learns the truth.', poster_path: '/matrix.jpg', popularity: 80 }] },
  'search/movie:inception': { results: [{ id: 27205, title: 'Inception', original_title: 'Inception', release_date: '2010-07-15', overview: 'Dreams within dreams.', poster_path: '/inception.jpg', popularity: 90 }] },
  'search/tv:breaking bad': { results: [{ id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad', first_air_date: '2008-01-20', overview: 'A chemistry teacher turns to crime.', poster_path: '/bb.jpg', popularity: 300 }] },
  'movie/603': {
    id: 603, imdb_id: 'tt0133093', title: 'The Matrix', original_title: 'The Matrix', overview: 'A hacker learns the truth about his reality.', release_date: '1999-03-30',
    runtime: 136, genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Science Fiction' }], vote_average: 8.2, vote_count: 25000, popularity: 80,
    poster_path: '/matrix.jpg', backdrop_path: '/matrix-bg.jpg',
    credits: { cast: [{ name: 'Keanu Reeves', character: 'Neo', profile_path: '/keanu.jpg', order: 0 }], crew: [{ name: 'Lana Wachowski', job: 'Director', department: 'Directing' }] },
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'R', type: 3 }] }] },
    images: { backdrops: [{ file_path: '/matrix-textless.jpg', iso_639_1: null, vote_average: 5, width: 1920 }], logos: [{ file_path: '/matrix-logo.png', iso_639_1: 'en', vote_average: 5, width: 800 }], posters: [] },
    keywords: { keywords: [{ id: 1, name: 'artificial intelligence' }] },
  },
  'movie/27205': {
    id: 27205, title: 'Inception', original_title: 'Inception', overview: 'A thief steals secrets through dreams.', release_date: '2010-07-15', runtime: 148,
    genres: [{ id: 28, name: 'Action' }], vote_average: 8.4, vote_count: 30000, popularity: 90, poster_path: '/inception.jpg', backdrop_path: '/inception-bg.jpg',
    release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13', type: 3 }] }] },
  },
  'tv/1396': {
    id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad', overview: 'A chemistry teacher turns to crime.', first_air_date: '2008-01-20', episode_run_time: [47],
    genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }], vote_average: 8.9, vote_count: 12000, popularity: 300, poster_path: '/bb.jpg', backdrop_path: '/bb-bg.jpg',
    seasons: [
      { season_number: 1, name: 'Season 1', overview: 'Walt starts cooking.', poster_path: '/s1.jpg' },
      { season_number: 2, name: 'Season 2', overview: '', poster_path: '/s2.jpg' },
    ],
    content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
    external_ids: { imdb_id: 'tt0903747', tvdb_id: 81189 },
  },
  'tv/1396/season/1': {
    episodes: [
      { season_number: 1, episode_number: 1, name: 'Pilot', overview: 'Walt gets a diagnosis.', still_path: '/e1.jpg', air_date: '2008-01-20', runtime: 58 },
      { season_number: 1, episode_number: 2, name: "Cat's in the Bag...", overview: 'Clean-up.', still_path: '/e2.jpg', air_date: '2008-01-27', runtime: 48 },
    ],
  },
  'tv/1396/season/2': { episodes: [{ season_number: 2, episode_number: 1, name: 'Seven Thirty-Seven', overview: 'Tuco.', still_path: null, air_date: '2009-03-08', runtime: 47 }] },
};

const fakeFetch: FetchJson = async <T,>(url: string) => {
  const u = new URL(url);
  const route = u.pathname.replace(/^\/3\//, '');
  const query = u.searchParams.get('query');
  const key = query ? `${route}:${query.toLowerCase()}` : route;
  return ((TMDB[key] as T | undefined) ?? (route.startsWith('search/') ? ({ results: [] } as T) : null)) as T | null;
};

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'HomeBlockbuster' };

const SRT = '1\n00:00:01,000 --> 00:00:03,500\nHello <i>there</i>\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line\n';

let tmp: string;
let media: string;
let services: Services;
let server: Server;
let base: string;

async function write(rel: string, content: string | number): Promise<string> {
  const file = path.join(media, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === 'number' ? Buffer.alloc(content, 7) : content);
  return file;
}

async function call<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T; res: Response }> {
  const res = await fetch(base + url, {
    method,
    headers: { 'X-Requested-With': 'HomeBlockbuster', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, data: data as T, res };
}

function config(dataDir: string, password: string | null = null): AppConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    webDir: null,
    ffmpegPath: null,
    ffprobePath: null,
    password,
    tmdbApiKey: null,
    omdbApiKey: null,
    mediaRoots: [],
    trustProxy: null,
    allowedHosts: [],
    allowExternalSymlinks: false,
    version: 'test',
  };
}

const noFfmpeg = { ffmpeg: null, ffprobe: null, version: null, encoders: new Set<string>() };

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-api-'));
  media = path.join(tmp, 'media');
  await write('Movies/The Matrix (1999)/The.Matrix.1999.1080p.BluRay.x264-GRP.mkv', 4096);
  await write('Movies/The Matrix (1999)/The.Matrix.1999.1080p.BluRay.x264-GRP.en.srt', SRT);
  await write('Movies/Inception.2010.720p.WEB-DL.mp4', 2048);
  await write('Movies/sample.mkv', 100);
  await write('Movies/.hidden/secret.mkv', 100);
  await write('Movies/@eaDir/thumb.mp4', 100);
  await write('Movies/notes.txt', 'not a video');
  await write('Shows/Breaking Bad/Season 01/Breaking.Bad.S01E01.Pilot.720p.mkv', 1024);
  await write('Shows/Breaking Bad/Season 01/Breaking.Bad.S01E02.720p.mkv', 1024);
  await write('Shows/Breaking Bad/Season 02/Breaking.Bad.S02E01.720p.mkv', 1024);

  services = await createServices(config(path.join(tmp, 'data')), { ffmpeg: noFfmpeg, fetchJson: fakeFetch });
  services.db.state.data.settings = { ...services.db.state.data.settings, tmdbApiKey: 'test-key', useTvmaze: false, useItunes: false };
  server = createApp(services).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await services.db.flush();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('libraries and scanning', () => {
  it('rejects folders that do not exist', async () => {
    const { status, data } = await call<{ error: string }>('POST', '/api/libraries', { name: 'Nope', path: path.join(tmp, 'missing'), kind: 'movies' });
    expect(status).toBe(400);
    expect(data.error).toMatch(/does not exist|not reachable/);
  });

  it('scans a movie library, skips samples and hidden folders, and matches metadata', async () => {
    const { status, data } = await call<LibraryDTO>('POST', '/api/libraries', { name: 'Movies', path: path.join(media, 'Movies'), kind: 'movies' });
    expect(status).toBe(201);
    await services.scanner.whenIdle();
    const libs = await call<LibraryDTO[]>('GET', '/api/libraries');
    const lib = libs.data.find((l) => l.id === data.id)!;
    expect(lib.fileCount).toBe(2);
    expect(lib.status).toBe('idle');

    const titles = (await call<TitleSummary[]>('GET', '/api/titles')).data;
    const matrix = titles.find((t) => t.name === 'The Matrix')!;
    expect(matrix).toBeDefined();
    expect(matrix.year).toBe(1999);
    expect(matrix.source).toBe('tmdb');
    expect(matrix.maturity).toBe('R');
    expect(matrix.genres).toEqual(['Action', 'Science Fiction']);
    expect(matrix.images.backdrop).toMatch(/^\/api\/img\?u=/);
    expect(decodeURIComponent(matrix.images.backdrop!)).toContain('/original/matrix-textless.jpg');
    expect(decodeURIComponent(matrix.images.logo!)).toContain('matrix-logo.png');
    expect(titles.find((t) => t.name === 'Inception')?.maturity).toBe('PG-13');
  });

  it('groups episodes into a show with seasons and episode metadata', async () => {
    await call('POST', '/api/libraries', { name: 'TV', path: path.join(media, 'Shows'), kind: 'shows' });
    await services.scanner.whenIdle();
    const titles = (await call<TitleSummary[]>('GET', '/api/titles')).data;
    const show = titles.find((t) => t.kind === 'show')!;
    expect(show.name).toBe('Breaking Bad');
    expect(show.seasonCount).toBe(2);
    expect(show.episodeCount).toBe(3);

    const detail = (await call<TitleDetail>('GET', `/api/titles/${show.id}`)).data;
    expect(detail.seasons.map((s) => s.number)).toEqual([1, 2]);
    expect(detail.seasons[0]!.episodes.map((e) => e.name)).toEqual(['Pilot', "Cat's in the Bag..."]);
    expect(detail.seasons[1]!.episodes[0]!.name).toBe('Seven Thirty-Seven');
    expect(detail.externalIds.tvdb).toBe(81189);
    expect(show.playFileId).toBe(detail.seasons[0]!.episodes[0]!.fileId);
  });

  it('detects sidecar subtitles and serves parsed cues', async () => {
    const titles = (await call<TitleSummary[]>('GET', '/api/titles')).data;
    const matrix = titles.find((t) => t.name === 'The Matrix')!;
    const detail = (await call<TitleDetail>('GET', `/api/titles/${matrix.id}`)).data;
    const sub = detail.files[0]!.subtitles[0]!;
    expect(sub.language).toBe('en');
    const cues = (await call<{ cues: Array<{ start: number; end: number; text: string }> }>('GET', `/api/subtitles/${detail.files[0]!.id}/${sub.id}`)).data.cues;
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ start: 1, end: 3.5, text: 'Hello <i>there</i>' });
  });

  it('streams files with HTTP range support', async () => {
    const titles = (await call<TitleSummary[]>('GET', '/api/titles')).data;
    const fileId = titles.find((t) => t.name === 'Inception')!.playFileId!;
    const res = await fetch(`${base}/api/stream/${fileId}`, { headers: { Range: 'bytes=100-199' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-199/2048');
    expect((await res.arrayBuffer()).byteLength).toBe(100);
    const bad = await fetch(`${base}/api/stream/${fileId}`, { headers: { Range: 'bytes=5000-' } });
    expect(bad.status).toBe(416);
  });

  it('describes playback, including the next episode', async () => {
    const titles = (await call<TitleSummary[]>('GET', '/api/titles')).data;
    const show = titles.find((t) => t.kind === 'show')!;
    const info = (await call<PlaybackInfo>('GET', `/api/playback/${show.playFileId}?caps=h264,aac`)).data;
    expect(info.mode).toBe('direct');
    expect(info.canTranscode).toBe(false);
    expect(info.episode).toMatchObject({ season: 1, episode: 1, name: 'Pilot' });
    expect(info.next).toMatchObject({ season: 1, episode: 2 });
  });

  it('removes titles whose files disappeared', async () => {
    await fs.rm(path.join(media, 'Movies/Inception.2010.720p.WEB-DL.mp4'));
    const lib = (await call<LibraryDTO[]>('GET', '/api/libraries')).data.find((l) => l.name === 'Movies')!;
    await call('POST', `/api/libraries/${lib.id}/scan`, {});
    await services.scanner.whenIdle();
    const titles = (await call<TitleSummary[]>('GET', '/api/titles')).data;
    expect(titles.some((t) => t.name === 'Inception')).toBe(false);
    expect(titles.some((t) => t.name === 'The Matrix')).toBe(true);
  });

  it('keeps titles and marks the library offline when its drive is gone', async () => {
    const moved = path.join(tmp, 'unplugged');
    await fs.rename(path.join(media, 'Movies'), moved);
    const lib = (await call<LibraryDTO[]>('GET', '/api/libraries')).data.find((l) => l.name === 'Movies')!;
    await call('POST', `/api/libraries/${lib.id}/scan`, {});
    await services.scanner.whenIdle();
    const after = (await call<LibraryDTO[]>('GET', '/api/libraries')).data.find((l) => l.name === 'Movies')!;
    expect(after.status).toBe('offline');
    expect(after.fileCount).toBe(1);
    const matrix = (await call<TitleSummary[]>('GET', '/api/titles')).data.find((t) => t.name === 'The Matrix')!;
    expect(matrix.available).toBe(false);
    await fs.rename(moved, path.join(media, 'Movies'));
    await call('POST', `/api/libraries/${lib.id}/scan`, {});
    await services.scanner.whenIdle();
    expect((await call<LibraryDTO[]>('GET', '/api/libraries')).data.find((l) => l.name === 'Movies')!.status).toBe('idle');
  });

  it('rejects libraries that overlap an existing one', async () => {
    const parent = await call<{ error: string }>('POST', '/api/libraries', { name: 'All', path: media, kind: 'mixed' });
    expect(parent.status).toBe(400);
    expect(parent.data.error).toMatch(/contains the library/);
    const child = await call<{ error: string }>('POST', '/api/libraries', { name: 'Matrix', path: path.join(media, 'Movies', 'The Matrix (1999)'), kind: 'movies' });
    expect(child.status).toBe(400);
    expect(child.data.error).toMatch(/inside the library "Movies"/);
    const same = await call<{ error: string }>('POST', '/api/libraries', { name: 'Again', path: `${path.join(media, 'Movies')}/`, kind: 'movies' });
    expect(same.data.error).toMatch(/already a library/);
    const movies = (await call<LibraryDTO[]>('GET', '/api/libraries')).data.find((l) => l.name === 'Movies')!;
    expect((await call('PUT', `/api/libraries/${movies.id}`, { path: media })).status).toBe(400);
    expect((await call<LibraryDTO[]>('GET', '/api/libraries')).data.find((l) => l.id === movies.id)!.path).toBe(path.join(media, 'Movies'));
  });

  it('only follows symlinks that stay inside the libraries', async () => {
    const secret = path.join(tmp, 'secret.txt');
    await fs.writeFile(secret, 'TOP-SECRET');
    await write('Links/Real/Big Buck Bunny (2008).mp4', 512);
    await fs.mkdir(path.join(media, 'Links/Alias'), { recursive: true });
    await fs.symlink(path.join(media, 'Links/Real/Big Buck Bunny (2008).mp4'), path.join(media, 'Links/Alias/Sintel (2010).mp4'));
    await fs.symlink(secret, path.join(media, 'Links/Leaked Secret (2019).mp4'));
    await fs.symlink(tmp, path.join(media, 'Links/Outside'));

    const lib = (await call<LibraryDTO>('POST', '/api/libraries', { name: 'Links', path: path.join(media, 'Links'), kind: 'movies' })).data;
    await services.scanner.whenIdle();
    const files = services.repo.filesOfLibrary(lib.id).map((f) => path.basename(f.path)).sort();
    expect(files).toEqual(['Big Buck Bunny (2008).mp4', 'Sintel (2010).mp4']);

    // A link swapped after the scan is refused when streaming.
    const alias = services.repo.filesOfLibrary(lib.id).find((f) => f.path.includes('Alias'))!;
    expect((await fetch(`${base}/api/stream/${alias.id}`)).status).toBe(200);
    await fs.rm(alias.path);
    await fs.symlink(secret, alias.path);
    const res = await fetch(`${base}/api/stream/${alias.id}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('TOP-SECRET');

    await call('DELETE', `/api/libraries/${lib.id}`);
    await fs.rm(path.join(media, 'Links'), { recursive: true, force: true });
  });
});

describe('profiles', () => {
  it('starts with a default and a kids profile, and supports CRUD', async () => {
    const list = (await call<ProfileDTO[]>('GET', '/api/profiles')).data;
    expect(list.map((p) => p.name)).toEqual(['Me', 'Kids']);
    const created = await call<ProfileDTO>('POST', '/api/profiles', { name: 'Alex', avatar: 'grin-orange', kids: false });
    expect(created.status).toBe(201);
    expect((await call('POST', '/api/profiles', { name: 'alex' })).status).toBe(400);
    const renamed = await call<ProfileDTO>('PUT', `/api/profiles/${created.data.id}`, { name: 'Alexandra', autoplayPreviews: false });
    expect(renamed.data).toMatchObject({ name: 'Alexandra', autoplayPreviews: false });
    expect((await call('DELETE', `/api/profiles/${created.data.id}`)).status).toBe(200);
  });

  it('keeps My List, ratings and progress per profile, and builds Continue Watching', async () => {
    const me = (await call<ProfileDTO[]>('GET', '/api/profiles')).data[0]!;
    const titles = (await call<TitleSummary[]>('GET', '/api/titles')).data;
    const matrix = titles.find((t) => t.name === 'The Matrix')!;
    const show = titles.find((t) => t.kind === 'show')!;

    let state = (await call<ProfileState>('PUT', `/api/profiles/${me.id}/list/${matrix.id}`)).data;
    expect(state.myList).toEqual([matrix.id]);
    state = (await call<ProfileState>('PUT', `/api/profiles/${me.id}/ratings/${matrix.id}`, { rating: 2 })).data;
    expect(state.ratings[matrix.id]).toBe(2);

    // Half-way through the movie, finished the first episode.
    await call('POST', `/api/profiles/${me.id}/progress`, { fileId: matrix.playFileId, position: 3000, duration: 8160 });
    const first = await call<{ finished: boolean }>('POST', `/api/profiles/${me.id}/progress`, { fileId: show.playFileId, position: 3450, duration: 3480 });
    expect(first.data.finished).toBe(true);

    const items = (await call<ContinueItem[]>('GET', `/api/profiles/${me.id}/continue`)).data;
    const movieItem = items.find((i) => i.titleId === matrix.id)!;
    expect(movieItem.progress).toBeCloseTo(3000 / 8160, 3);
    const upNext = items.find((i) => i.titleId === show.id)!;
    expect(upNext.upNext).toBe(true);
    expect(upNext.episode).toMatchObject({ season: 1, episode: 2 });

    // Resume position is offered by the playback endpoint.
    const info = (await call<PlaybackInfo>('GET', `/api/playback/${matrix.playFileId}?profile=${me.id}`)).data;
    expect(info.resumeAt).toBe(3000);

    await call('DELETE', `/api/profiles/${me.id}/continue/${matrix.id}`);
    const hidden = (await call<ContinueItem[]>('GET', `/api/profiles/${me.id}/continue`)).data;
    expect(hidden.some((i) => i.titleId === matrix.id)).toBe(false);
  });

  it('hides mature titles from kids profiles', async () => {
    const kids = (await call<ProfileDTO[]>('GET', '/api/profiles')).data.find((p) => p.kids)!;
    const titles = (await call<TitleSummary[]>('GET', `/api/titles?profile=${kids.id}`)).data;
    expect(titles.some((t) => t.maturity === 'R' || t.maturity === 'TV-MA')).toBe(false);
  });

  it('refuses deep links to mature titles on kids profiles', async () => {
    const kids = (await call<ProfileDTO[]>('GET', '/api/profiles')).data.find((p) => p.kids)!;
    const matrix = (await call<TitleSummary[]>('GET', '/api/titles')).data.find((t) => t.name === 'The Matrix')!;
    expect((await call('GET', `/api/titles/${matrix.id}?profile=${kids.id}`)).status).toBe(404);
    expect((await call('GET', `/api/playback/${matrix.playFileId}?profile=${kids.id}`)).status).toBe(403);
    expect((await call('GET', `/api/titles/${matrix.id}`)).status).toBe(200);
  });

  it('only treats clearly child-safe ratings and genres as kid friendly', () => {
    expect(isKidFriendly({ maturity: 'PG', genres: [] })).toBe(true);
    expect(isKidFriendly({ maturity: 'A', genres: ['Family'] })).toBe(false); // "adults only" in India
    expect(isKidFriendly({ maturity: null, genres: ['Animation'] })).toBe(false);
    expect(isKidFriendly({ maturity: null, genres: ['Animation', 'Family'] })).toBe(true);
    expect(isKidFriendly({ maturity: null, genres: ['Family', 'Horror'] })).toBe(false);
  });
});

describe('request guard', () => {
  it('rejects state-changing requests without the client header (CSRF)', async () => {
    const res = await fetch(`${base}/api/scan`, { method: 'POST' });
    expect(res.status).toBe(403);
    const form = await fetch(`${base}/api/profiles`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"name":"x"}' });
    expect(form.status).toBe(403);
    expect((await fetch(`${base}/api/titles`)).status).toBe(200);
  });

  it('returns 404 for ids that are object prototype keys', async () => {
    expect((await call('GET', '/api/titles/__proto__')).status).toBe(404);
    expect((await call('GET', '/api/playback/constructor')).status).toBe(404);
  });

  it('refuses unknown public host names without a password (DNS rebinding)', async () => {
    const get = (host: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(`${base}/api/system`, { headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
    expect(await get('evil.example:8585')).toBe(403);
    expect(await get('nas.local:8585')).toBe(200);
    expect(await get('192.168.1.20:8585')).toBe(200);
  });

  it('recognises LAN and allowed host names', () => {
    expect(isAllowedHost('localhost', [])).toBe(true);
    expect(isAllowedHost('[::1]', [])).toBe(true);
    expect(isAllowedHost('nas', [])).toBe(true);
    expect(isAllowedHost('media.home.arpa', [])).toBe(true);
    expect(isAllowedHost('rebind.attacker.com', [])).toBe(false);
    expect(isAllowedHost('media.example.com', ['media.example.com'])).toBe(true);
    expect(isAllowedHost('tv.example.com', ['.example.com'])).toBe(true);
    expect(isAllowedHost('example.com.evil.net', ['.example.com'])).toBe(false);
  });
});

describe('settings and system', () => {
  it('masks API keys and ignores masked values on save', async () => {
    const s = (await call<{ tmdbApiKey: string }>('GET', '/api/settings')).data;
    expect(s.tmdbApiKey).toMatch(/^•+-key$/);
    await call('PUT', '/api/settings', { tmdbApiKey: s.tmdbApiKey, region: 'ch' });
    expect(services.db.state.data.settings.tmdbApiKey).toBe('test-key');
    expect(services.db.state.data.settings.region).toBe('CH');
    expect((await call('PUT', '/api/settings', { metadataLanguage: 'nonsense' })).status).toBe(400);
  });

  it('reports system info and browses folders', async () => {
    const info = (await call<{ titleCount: number; ffmpeg: { available: boolean } }>('GET', '/api/system')).data;
    expect(info.titleCount).toBeGreaterThan(0);
    expect(info.ffmpeg.available).toBe(false);
    const listing = (await call<{ entries: Array<{ name: string }>; videoCount: number }>('GET', `/api/fs/list?path=${encodeURIComponent(path.join(media, 'Movies'))}`)).data;
    expect(listing.entries.map((e) => e.name)).toEqual(['The Matrix (1999)']);
    expect(listing.videoCount).toBe(0); // only sample.mkv is left, which the scanner skips
    const check = (await call<{ ok: boolean; videoCount: number }>('POST', '/api/fs/check', { path: path.join(media, 'Shows') })).data;
    expect(check).toMatchObject({ ok: true, videoCount: 3 });
  });
});

describe('password protection', () => {
  it('requires signing in when HB_PASSWORD is set', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-auth-'));
    const secured = await createServices(config(dir, 's3cret'), { ffmpeg: noFfmpeg, fetchJson: fakeFetch });
    const srv = createApp(secured).listen(0, '127.0.0.1');
    await new Promise((resolve) => srv.once('listening', resolve));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${url}/api/titles`)).status).toBe(401);
      expect((await fetch(`${url}/api/health`)).status).toBe(200);
      const bad = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ password: 'nope' }) });
      expect(bad.status).toBe(401);
      const ok = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ password: 's3cret' }) });
      const cookie = ok.headers.get('set-cookie')!.split(';')[0]!;
      expect((await fetch(`${url}/api/titles`, { headers: { Cookie: cookie } })).status).toBe(200);
    } finally {
      await new Promise((resolve) => srv.close(resolve));
      await secured.db.flush();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('sets, uses, revokes and removes a password set in the app', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-auth-'));
    const svc = await createServices(config(dir), { ffmpeg: noFfmpeg, fetchJson: fakeFetch });
    const srv = createApp(svc).listen(0, '127.0.0.1');
    await new Promise((resolve) => srv.once('listening', resolve));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const put = (body: unknown, cookie = ''): Promise<Response> =>
      fetch(`${url}/api/auth/password`, { method: 'PUT', headers: { ...JSON_HEADERS, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    try {
      expect((await fetch(`${url}/api/titles`)).status).toBe(200);
      expect((await put({ password: 'abc' })).status).toBe(400);
      const set = await put({ password: 'hunter22' });
      expect(set.status).toBe(200);
      const cookie = set.headers.get('set-cookie')!.split(';')[0]!;
      expect(svc.db.state.data.passwordHash).toMatch(/^scrypt:/);
      expect((await fetch(`${url}/api/titles`)).status).toBe(401);
      expect((await fetch(`${url}/api/titles`, { headers: { Cookie: cookie } })).status).toBe(200);

      // Changing it needs the current password.
      expect((await put({ password: 'another1' })).status).toBe(401);
      expect((await put({ current: 'wrong', password: 'another1' }, cookie)).status).toBe(403);

      // Signing out revokes that session.
      expect((await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { ...JSON_HEADERS, Cookie: cookie } })).status).toBe(200);
      expect((await fetch(`${url}/api/titles`, { headers: { Cookie: cookie } })).status).toBe(401);

      const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ password: 'hunter22' }) });
      const fresh = login.headers.get('set-cookie')!.split(';')[0]!;
      const removed = await put({ current: 'hunter22', password: '' }, fresh);
      expect(removed.status).toBe(200);
      expect(svc.db.state.data.passwordHash).toBeNull();
      expect((await fetch(`${url}/api/titles`)).status).toBe(200);
    } finally {
      await new Promise((resolve) => srv.close(resolve));
      await svc.db.flush();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves HB_PASSWORD in charge', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hb-auth-'));
    const svc = await createServices(config(dir, 's3cret'), { ffmpeg: noFfmpeg, fetchJson: fakeFetch });
    const srv = createApp(svc).listen(0, '127.0.0.1');
    await new Promise((resolve) => srv.once('listening', resolve));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${url}/api/auth/password`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ password: 'takeover' }) });
      expect(res.status).toBe(409);
      // With a password, host names are not restricted (a rebinding page has no session cookie).
      const status = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(`${url}/api/auth/status`, { headers: { Host: 'media.example.com' } }, (r) => {
          r.resume();
          resolve(r.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
      expect(status).toBe(200);
    } finally {
      await new Promise((resolve) => srv.close(resolve));
      await svc.db.flush();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
