import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HttpError, MetadataUnavailableError, NetworkError, ProviderAuthError } from '../src/metadata/errors.js';
import { createFetchJson, redactUrl } from '../src/metadata/http.js';
import { itunesProvider, parseSeasonNumber, upscaleArtwork } from '../src/metadata/itunes.js';
import { cleanText, normalizeTitle, pickBest, scoreCandidate, similarity, titleCase } from '../src/metadata/matching.js';
import { omdbProvider, parseOmdbDate } from '../src/metadata/omdb.js';
import { MetadataService } from '../src/metadata/service.js';
import { tmdbProvider } from '../src/metadata/tmdb.js';
import { tvmazeProvider } from '../src/metadata/tvmaze.js';
import type { SettingsDTO } from '../src/shared/types.js';
import type { FetchJson, ProviderContext } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers: fixtures, settings and a fake FetchJson that never touches the network
// ---------------------------------------------------------------------------

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/metadata/${name}.json`, import.meta.url), 'utf8'));

function settings(overrides: Partial<SettingsDTO> = {}): SettingsDTO {
  return {
    tmdbApiKey: '0123456789abcdef0123456789abcdef',
    omdbApiKey: 'omdbkey1',
    metadataLanguage: 'en-US',
    region: 'US',
    useTvmaze: true,
    useItunes: true,
    autoScanMinutes: 0,
    transcoding: false,
    hwAccel: 'none',
    generateThumbnails: false,
    ...overrides,
  };
}

type Init = Parameters<FetchJson>[1];
type Matcher = (url: URL) => boolean;
type Route = [Matcher, unknown];

/** Matches a GET by host + exact path, plus the given query parameters. */
const on =
  (host: string, path: string, params: Record<string, string> = {}): Matcher =>
  (url) =>
    url.hostname === host &&
    url.pathname === path &&
    Object.entries(params).every(([key, value]) => url.searchParams.get(key) === value);

const tmdbRoute = (path: string, params?: Record<string, string>) => on('api.themoviedb.org', `/3${path}`, params);
const tvmazeRoute = (path: string, params?: Record<string, string>) => on('api.tvmaze.com', path, params);
const itunesRoute = (path: string, params?: Record<string, string>) => on('itunes.apple.com', path, params);
const omdbRoute = (params: Record<string, string>) => on('www.omdbapi.com', '/', params);

/** Routes URLs to canned JSON (first match wins). Error values are thrown; unmatched URLs act like a 404. */
function fakeFetch(routes: Route[]) {
  const calls: Array<{ url: URL; init: Init }> = [];
  const fetchJson: FetchJson = async <T>(url: string, init?: Init): Promise<T | null> => {
    const parsed = new URL(url);
    calls.push({ url: parsed, init });
    const route = routes.find(([match]) => match(parsed));
    if (!route) {
      if (init?.allow404) return null;
      throw new HttpError(404, url, 'no fixture');
    }
    if (route[1] instanceof Error) throw route[1];
    return structuredClone(route[1]) as T;
  };
  return { fetchJson, calls };
}

const ctxFor = (fetchJson: FetchJson, overrides: Partial<SettingsDTO> = {}): ProviderContext => ({
  settings: settings(overrides),
  fetchJson,
});

const TMDB_IMG = 'https://image.tmdb.org/t/p';

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe('matching', () => {
  it('normalises titles', () => {
    expect(normalizeTitle('The Matrix')).toBe('matrix');
    expect(normalizeTitle('Matrix, The')).toBe('matrix');
    expect(normalizeTitle('Amélie')).toBe('amelie');
    expect(normalizeTitle('Law & Order: SVU')).toBe('law and order svu');
    expect(normalizeTitle("Ocean's Eleven")).toBe('oceans eleven');
    expect(normalizeTitle('Ocean’s Eleven')).toBe('oceans eleven');
    expect(normalizeTitle('Rocky II')).toBe('rocky 2');
    expect(normalizeTitle('Star Wars: Episode IV - A New Hope')).toBe('star wars episode 4 a new hope');
    expect(normalizeTitle('  WALL·E  ')).toBe('wall e');
    expect(normalizeTitle('Doctor Who (2005)')).toBe('doctor who');
    expect(normalizeTitle('Theodore Rex')).toBe('theodore rex');
    expect(normalizeTitle('The')).toBe('the');
  });

  it('computes similarity in [0, 1]', () => {
    expect(similarity('The Matrix', 'Matrix')).toBe(1);
    expect(similarity('Spider-Man', 'Spiderman')).toBeGreaterThan(0.9);
    expect(similarity('Harry Potter and the Sorcerer’s Stone', "Harry Potter and the Philosopher's Stone")).toBeGreaterThan(0.75);
    expect(similarity('The Shawshank Redemtion', 'The Shawshank Redemption')).toBeGreaterThan(0.7);
    expect(similarity('The Matrix', 'The Matrix Reloaded')).toBeLessThan(0.75);
    expect(similarity('Toy Story 3', 'Toy Story 2')).toBeLessThan(0.75);
    expect(similarity('Frozen', 'Frozen II')).toBeLessThan(0.75);
    expect(similarity('Alien', 'Aliens')).toBeLessThan(0.75);
    expect(similarity('Up', 'Up in the Air')).toBeLessThan(0.5);
    expect(similarity('Breaking Bad', 'Better Call Saul')).toBeLessThan(0.3);
    expect(similarity('', 'Matrix')).toBe(0);
    for (const [a, b] of [
      ['a', 'b'],
      ['x', 'xx'],
      ['Lord of the Rings Fellowship of the Ring', 'The Lord of the Rings: The Fellowship of the Ring'],
    ] as const) {
      const score = similarity(a, b);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('adjusts candidate scores by year', () => {
    const matrix = { name: 'The Matrix', originalName: 'The Matrix', year: 1999 };
    expect(scoreCandidate({ name: 'The Matrix', year: 1999 }, matrix)).toBeCloseTo(1.25);
    expect(scoreCandidate({ name: 'The Matrix' }, matrix)).toBeCloseTo(1.05);
    expect(scoreCandidate({ name: 'The Matrix', year: 2000 }, matrix)).toBeCloseTo(1.1);
    expect(scoreCandidate({ name: 'The Matrix', year: 2021 }, matrix)).toBeLessThan(0.75);
    expect(scoreCandidate({ name: 'The Matrix', year: 1999 }, { ...matrix, year: null })).toBeCloseTo(1.05);
  });

  it('matches on the original title, "The" and roman numerals', () => {
    const amelie = { name: 'Amélie', originalName: "Le Fabuleux Destin d'Amélie Poulain", year: 2001 };
    expect(scoreCandidate({ name: 'Le fabuleux destin d’Amelie Poulain', year: 2001 }, amelie)).toBeCloseTo(1.25);
    expect(scoreCandidate({ name: 'Matrix' }, { name: 'The Matrix', year: 1999 })).toBeCloseTo(1.05);
    expect(scoreCandidate({ name: 'Rocky 2', year: 1979 }, { name: 'Rocky II', year: 1979 })).toBeCloseTo(1.25);
    expect(scoreCandidate({ name: 'Rocky 3' }, { name: 'Rocky II', year: 1979 })).toBeLessThan(0.75);
  });

  it('accepts a subtitle-extended query only with a matching year, below an exact match', () => {
    const starWars = { name: 'Star Wars', year: 1977 };
    const query = { name: 'Star Wars Episode IV A New Hope', year: 1977 };
    const partial = scoreCandidate(query, starWars);
    expect(partial).toBeGreaterThanOrEqual(0.75);
    expect(partial).toBeLessThan(scoreCandidate({ name: 'Star Wars', year: 1977 }, starWars));
    expect(partial).toBeLessThan(scoreCandidate(query, { name: 'Star Wars: Episode IV - A New Hope', year: 1977 }));
    expect(scoreCandidate({ name: query.name }, starWars)).toBeLessThan(0.75);
    expect(scoreCandidate({ name: 'Dr Strangelove', year: 1964 }, {
      name: 'Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb',
      year: 1964,
    })).toBeGreaterThanOrEqual(0.75);
  });

  it('picks the best candidate above the threshold', () => {
    const candidates = [
      { name: 'The Matrix Reloaded', year: 2003, popularity: 54 },
      { name: 'The Matrix', year: 1999, popularity: 94 },
      { name: 'The Matrix Resurrections', year: 2021, popularity: 60 },
    ];
    const best = pickBest({ name: 'The Matrix', year: 1999 }, candidates);
    expect(best?.name).toBe('The Matrix');
    expect(best?.popularity).toBe(94);
    expect(best?.score).toBeCloseTo(1.25);
    expect(pickBest({ name: 'Matrix Reloaded' }, candidates)?.name).toBe('The Matrix Reloaded');
    expect(pickBest({ name: 'The Matrix', year: 2010 }, candidates)).toBeNull();
    expect(pickBest({ name: 'Inception', year: 2010 }, candidates)).toBeNull();
    expect(pickBest({ name: 'The Matrix Reloaded' }, candidates, 1.1)).toBeNull();
    expect(pickBest({ name: 'The Matrix' }, [])).toBeNull();
  });

  it('keeps the provider order when scores tie', () => {
    const candidates = [
      { name: 'The Office', year: 2005, popularity: 10 },
      { name: 'The Office', year: 2001, popularity: 90 },
    ];
    expect(pickBest({ name: 'The Office' }, candidates)?.year).toBe(2005);
    expect(pickBest({ name: 'The Office', year: 2001 }, candidates)?.year).toBe(2001);
  });

  it('cleans HTML overviews and title-cases keywords', () => {
    expect(cleanText('<p><b>Breaking Bad</b> follows Walter&#39;s &amp; Jesse&rsquo;s story.</p><p>Second&nbsp;part.</p>')).toBe(
      'Breaking Bad follows Walter\'s & Jesse’s story. Second part.',
    );
    expect(cleanText('Tom &amp; Jerry &lt;3 &#x2014; &unknown;')).toBe('Tom & Jerry <3 — &unknown;');
    expect(cleanText(null)).toBe('');
    expect(titleCase('saving the world')).toBe('Saving the World');
    expect(titleCase('artificial intelligence (a.i.)')).toBe('Artificial Intelligence (A.I.)');
    expect(titleCase("man vs machine, don't panic")).toBe("Man vs Machine, Don't Panic");
  });
});

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

describe('createFetchJson', () => {
  type Handler = (url: string, init: RequestInit | undefined, attempt: number) => Response | Promise<Response>;

  function fakeFetchImpl(handler: Handler) {
    const calls: Array<{ url: string; init?: RequestInit; at: number }> = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init, at: Date.now() });
      return handler(url, init, calls.length);
    }) as typeof fetch;
    return { impl, calls };
  }

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fast = { retryBaseMs: 1, maxRetryAfterMs: 50 };

  it('parses JSON and sends default + custom headers', async () => {
    const { impl, calls } = fakeFetchImpl(() => json({ ok: true }));
    const fetchJson = createFetchJson({ fetchImpl: impl, ...fast });
    await expect(fetchJson('https://api.example.com/x', { headers: { Authorization: 'Bearer abc' } })).resolves.toEqual({
      ok: true,
    });
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
    expect(headers['User-Agent']).toBe('HomeBlockbuster/1.0 (+https://github.com/swissmarley/home-blockbuster)');
    expect(headers.Authorization).toBe('Bearer abc');
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null for an empty body', async () => {
    const { impl } = fakeFetchImpl(() => new Response('', { status: 200 }));
    await expect(createFetchJson({ fetchImpl: impl, ...fast })('https://x.test/empty')).resolves.toBeNull();
  });

  it('rejects a body that is not JSON', async () => {
    const { impl } = fakeFetchImpl(() => new Response('<html>captive portal</html>', { status: 200 }));
    const error = await createFetchJson({ fetchImpl: impl, ...fast })('https://x.test/html').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).message).toMatch(/not valid JSON/);
  });

  it('retries 5xx responses and then succeeds', async () => {
    const { impl, calls } = fakeFetchImpl((_url, _init, n) => (n < 3 ? json({ message: 'busy' }, 503) : json({ ok: 1 })));
    await expect(createFetchJson({ fetchImpl: impl, ...fast })('https://x.test/busy')).resolves.toEqual({ ok: 1 });
    expect(calls).toHaveLength(3);
  });

  it('gives up after three attempts', async () => {
    const { impl, calls } = fakeFetchImpl(() => json({}, 500));
    const error = await createFetchJson({ fetchImpl: impl, ...fast })('https://x.test/down').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(500);
    expect(calls).toHaveLength(3);
  });

  it('honours Retry-After on 429, capped', async () => {
    const { impl, calls } = fakeFetchImpl((_url, _init, n) =>
      n === 1 ? json({ status_code: 25, status_message: 'Too many requests' }, 429, { 'Retry-After': '120' }) : json([1]),
    );
    const fetchJson = createFetchJson({ fetchImpl: impl, retryBaseMs: 1, maxRetryAfterMs: 60 });
    await expect(fetchJson('https://x.test/limited')).resolves.toEqual([1]);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(50);
  });

  it('returns null on 404 when allowed and throws otherwise, without retrying', async () => {
    const { impl, calls } = fakeFetchImpl(() =>
      json({ status_code: 34, status_message: 'The resource you requested could not be found.', success: false }, 404),
    );
    const fetchJson = createFetchJson({ fetchImpl: impl, ...fast });
    await expect(fetchJson('https://x.test/missing', { allow404: true })).resolves.toBeNull();
    const error = await fetchJson('https://x.test/missing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect((error as HttpError).message).toContain('could not be found');
    expect(calls).toHaveLength(2);
  });

  it('throws ProviderAuthError on 401/403 without retrying and never leaks the key', async () => {
    const { impl, calls } = fakeFetchImpl((url) =>
      url.includes('omdbapi')
        ? json({ Response: 'False', Error: 'Invalid API key!' }, 401)
        : json({ status_code: 7, status_message: 'Invalid API key: You must be granted a valid key.', success: false }, 401),
    );
    const fetchJson = createFetchJson({ fetchImpl: impl, ...fast });
    const tmdbError = await fetchJson('https://api.themoviedb.org/3/search/movie?query=x&api_key=SECRET123').catch(
      (e: unknown) => e,
    );
    expect(tmdbError).toBeInstanceOf(ProviderAuthError);
    expect(tmdbError).toBeInstanceOf(HttpError);
    expect((tmdbError as ProviderAuthError).status).toBe(401);
    expect((tmdbError as ProviderAuthError).message).toContain('Invalid API key');
    expect((tmdbError as ProviderAuthError).message).not.toContain('SECRET123');
    expect((tmdbError as ProviderAuthError).url).toBe('https://api.themoviedb.org/3/search/movie?query=x&api_key=***');

    const omdbError = await fetchJson('https://www.omdbapi.com/?apikey=SECRET456&s=x').catch((e: unknown) => e);
    expect(omdbError).toBeInstanceOf(ProviderAuthError);
    expect((omdbError as ProviderAuthError).message).toContain('Invalid API key!');
    expect((omdbError as ProviderAuthError).message).not.toContain('SECRET456');
    expect(calls).toHaveLength(2);

    const { impl: forbidden, calls: forbiddenCalls } = fakeFetchImpl(() => new Response('Forbidden', { status: 403 }));
    await expect(createFetchJson({ fetchImpl: forbidden, ...fast })('https://itunes.apple.com/search')).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
    expect(forbiddenCalls).toHaveLength(1);
  });

  it('does not retry other 4xx responses', async () => {
    const { impl, calls } = fakeFetchImpl(() =>
      json({ errorMessage: 'Invalid value(s) for key(s): [media]', queryParameters: { media: 'films' } }, 400),
    );
    const error = await createFetchJson({ fetchImpl: impl, ...fast })('https://itunes.apple.com/search?media=films').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error).not.toBeInstanceOf(ProviderAuthError);
    expect((error as HttpError).message).toContain('Invalid value(s)');
    expect(calls).toHaveLength(1);
  });

  it('retries network errors and reports the last one as NetworkError', async () => {
    const refused = () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    };
    const { impl, calls } = fakeFetchImpl(refused);
    const error = await createFetchJson({ fetchImpl: impl, ...fast })('https://www.omdbapi.com/?apikey=SECRET&s=x').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toContain('ECONNREFUSED');
    expect((error as NetworkError).message).not.toContain('SECRET');
    expect(calls).toHaveLength(3);

    const { impl: flaky, calls: flakyCalls } = fakeFetchImpl((_url, _init, n) => (n === 1 ? refused() : json({ ok: 1 })));
    await expect(createFetchJson({ fetchImpl: flaky, ...fast })('https://x.test/flaky')).resolves.toEqual({ ok: 1 });
    expect(flakyCalls).toHaveLength(2);
  });

  it('times out slow requests', async () => {
    const { impl, calls } = fakeFetchImpl(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const fetchJson = createFetchJson({ fetchImpl: impl, timeoutMs: 20, maxAttempts: 2, retryBaseMs: 1 });
    const error = await fetchJson('https://x.test/slow').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).toContain('timed out after 20 ms');
    expect(calls).toHaveLength(2);
  });

  it('rate-limits each limiter with a sliding window, in request order', async () => {
    const { impl, calls } = fakeFetchImpl(() => json({}));
    const fetchJson = createFetchJson({ fetchImpl: impl, limits: { tmdb: { max: 2, perMs: 100 } } });
    const urls = [1, 2, 3, 4, 5].map((i) => `https://api.themoviedb.org/3/r${i}`);
    await Promise.all(urls.map((url) => fetchJson(url, { limiter: 'tmdb' })));
    expect(calls.map((c) => c.url)).toEqual(urls);
    const start = calls[0]!.at;
    expect(calls[1]!.at - start).toBeLessThan(50);
    expect(calls[2]!.at - start).toBeGreaterThanOrEqual(95);
    expect(calls[3]!.at - start).toBeGreaterThanOrEqual(95);
    expect(calls[4]!.at - start).toBeGreaterThanOrEqual(195);
  });

  it('keeps limiters independent', async () => {
    const { impl, calls } = fakeFetchImpl(() => json({}));
    const fetchJson = createFetchJson({ fetchImpl: impl, limits: { tmdb: { max: 1, perMs: 150 } } });
    await fetchJson('https://api.themoviedb.org/3/a', { limiter: 'tmdb' });
    const queued = fetchJson('https://api.themoviedb.org/3/b', { limiter: 'tmdb' });
    await fetchJson('https://api.tvmaze.com/c', { limiter: 'tvmaze' });
    await fetchJson('https://x.test/d');
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/3/a', '/c', '/d']);
    await queued;
    expect(calls).toHaveLength(4);
  });

  it('redacts API keys', () => {
    expect(redactUrl('https://www.omdbapi.com/?apikey=abc123&i=tt1')).toBe('https://www.omdbapi.com/?apikey=***&i=tt1');
    expect(redactUrl('https://api.themoviedb.org/3/movie/1?language=en&api_key=k')).toBe(
      'https://api.themoviedb.org/3/movie/1?language=en&api_key=***',
    );
  });
});

// ---------------------------------------------------------------------------
// TMDB
// ---------------------------------------------------------------------------

describe('tmdb provider', () => {
  const routes = (): Route[] => [
    [tmdbRoute('/search/movie', { query: 'The Matrix' }), fixture('tmdb-search-movie-matrix')],
    [tmdbRoute('/movie/603'), fixture('tmdb-movie-603')],
    [tmdbRoute('/search/tv', { query: 'Breaking Bad' }), fixture('tmdb-search-tv-breaking-bad')],
    [tmdbRoute('/tv/1396'), fixture('tmdb-tv-1396')],
    [tmdbRoute('/tv/1396/season/1'), fixture('tmdb-tv-1396-season-1')],
    [tmdbRoute('/find/tt0903747', { external_source: 'imdb_id' }), fixture('tmdb-find-tt0903747')],
    [tmdbRoute('/find/81189', { external_source: 'tvdb_id' }), fixture('tmdb-find-tt0903747')],
    [tmdbRoute('/find/tt0133093', { external_source: 'imdb_id' }), fixture('tmdb-find-tt0133093')],
  ];

  it('is enabled by an API key and supports both kinds', () => {
    expect(tmdbProvider.isEnabled(settings())).toBe(true);
    expect(tmdbProvider.isEnabled(settings({ tmdbApiKey: '  ' }))).toBe(false);
    expect(tmdbProvider.supports('movie') && tmdbProvider.supports('show')).toBe(true);
  });

  it('searches movies with api_key auth and maps candidates', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    const results = await tmdbProvider.search({ kind: 'movie', name: 'The Matrix', year: 1999 }, ctxFor(fetchJson));
    const { url, init } = calls[0]!;
    expect(url.pathname).toBe('/3/search/movie');
    expect(url.searchParams.get('query')).toBe('The Matrix');
    expect(url.searchParams.get('year')).toBe('1999');
    expect(url.searchParams.get('include_adult')).toBe('false');
    expect(url.searchParams.get('language')).toBe('en-US');
    expect(url.searchParams.get('api_key')).toBe('0123456789abcdef0123456789abcdef');
    expect(init?.headers?.Authorization).toBeUndefined();
    expect(init?.limiter).toBe('tmdb');

    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({
      provider: 'tmdb',
      id: '603',
      kind: 'movie',
      name: 'The Matrix',
      originalName: 'The Matrix',
      year: 1999,
      overview: expect.stringContaining('Set in the 22nd century'),
      poster: `${TMDB_IMG}/w342/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg`,
      popularity: 94.521,
    });
    expect(results.find((r) => r.id === '684428')).toMatchObject({ year: null, poster: null, overview: '' });
  });

  it('sends v4 read access tokens as a bearer header', async () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0In0.c2lnbmF0dXJl';
    const { fetchJson, calls } = fakeFetch(routes());
    await tmdbProvider.search({ kind: 'movie', name: 'The Matrix' }, ctxFor(fetchJson, { tmdbApiKey: token }));
    expect(calls[0]!.init?.headers?.Authorization).toBe(`Bearer ${token}`);
    expect(calls[0]!.url.searchParams.has('api_key')).toBe(false);
    expect(calls[0]!.url.searchParams.has('year')).toBe(false);
  });

  it('searches shows by first air date year', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    const results = await tmdbProvider.search({ kind: 'show', name: 'Breaking Bad', year: 2008 }, ctxFor(fetchJson));
    expect(calls[0]!.url.pathname).toBe('/3/search/tv');
    expect(calls[0]!.url.searchParams.get('first_air_date_year')).toBe('2008');
    expect(results.map((r) => [r.id, r.name, r.year])).toEqual([
      ['1396', 'Breaking Bad', 2008],
      ['239770', 'Breaking Bad: Original Minisodes', 2009],
    ]);
    expect(results[1]!.poster).toBeNull();
  });

  it('maps movie details', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    const title = await tmdbProvider.getDetails('603', 'movie', ctxFor(fetchJson));
    expect(calls[0]!.url.pathname).toBe('/3/movie/603');
    expect(calls[0]!.url.searchParams.get('append_to_response')).toBe('credits,release_dates,images,keywords');
    expect(calls[0]!.url.searchParams.get('include_image_language')).toBe('en,null');
    expect(calls[0]!.init?.allow404).toBe(true);

    expect(title).toMatchObject({
      provider: 'tmdb',
      providerId: '603',
      kind: 'movie',
      name: 'The Matrix',
      originalName: 'The Matrix',
      year: 1999,
      releaseDate: '1999-03-31',
      tagline: 'Welcome to the Real World.',
      genres: ['Action', 'Science Fiction'],
      rating: 8.2,
      voteCount: 26402,
      popularity: 94.521,
      maturity: 'R',
      runtime: 136,
      directors: ['Lana Wachowski', 'Lilly Wachowski'],
      writers: ['Lana Wachowski', 'Lilly Wachowski'],
      creators: [],
      studios: ['Village Roadshow Pictures', 'Groucho II Film Partnership', 'Silver Pictures'],
      externalIds: { tmdb: 603, imdb: 'tt0133093' },
      seasons: {},
    });
    expect(title!.overview).toMatch(/^Set in the 22nd century/);
    expect(title!.tags).toEqual([
      'Saving the World',
      'Artificial Intelligence (A.I.)',
      'Man vs Machine',
      'Philosophy',
      'Prophecy',
      'Dystopia',
      'Virtual Reality',
      'Insurrection',
    ]);
    expect(title!.cast).toHaveLength(15);
    expect(title!.cast[0]).toEqual({
      name: 'Keanu Reeves',
      character: 'Thomas A. Anderson / Neo',
      photo: `${TMDB_IMG}/w185/4D0PpNI0kmP58hgrwGC3wCjxhnm.jpg`,
    });
    expect(title!.cast[13]).toEqual({ name: 'David Aston', character: 'Rhineheart', photo: null });
  });

  it('picks a textless backdrop, a titled card and a PNG logo', async () => {
    const { fetchJson } = fakeFetch(routes());
    const title = await tmdbProvider.getDetails('603', 'movie', ctxFor(fetchJson));
    expect(title!.images).toEqual({
      poster: `${TMDB_IMG}/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg`,
      // Language-less, top voted, widest on a tie.
      backdrop: `${TMDB_IMG}/original/icmmSD4vTTDKOq2vvdulafOGw93.jpg`,
      // Best English-tagged backdrop (contains the title treatment).
      card: `${TMDB_IMG}/w780/2u7zbn8EudG6kLlBzUYqP8RyFU4.jpg`,
      cardHasTitle: true,
      // PNG preferred over the better voted SVG.
      logo: `${TMDB_IMG}/w500/8OAk9sL5DUmbUMZSAqBWvEaa0Kd.png`,
    });
  });

  it('prefers artwork in the metadata language', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    const title = await tmdbProvider.getDetails('603', 'movie', ctxFor(fetchJson, { metadataLanguage: 'de-DE' }));
    expect(calls[0]!.url.searchParams.get('language')).toBe('de-DE');
    expect(calls[0]!.url.searchParams.get('include_image_language')).toBe('de,en,null');
    expect(title!.images.card).toBe(`${TMDB_IMG}/w780/8sdRBsFOe0g8FoF6qA5hHGjDw1v.jpg`);
    expect(title!.images.logo).toBe(`${TMDB_IMG}/w500/1MtqYWdqgJKqM5KTVvWtHrrLNxV.png`);
    expect(title!.images.backdrop).toBe(`${TMDB_IMG}/original/icmmSD4vTTDKOq2vvdulafOGw93.jpg`);
  });

  it('falls back to backdrop_path when there is no image list', async () => {
    const details = fixture('tmdb-movie-603') as Record<string, unknown>;
    delete details.images;
    const { fetchJson } = fakeFetch([[tmdbRoute('/movie/603'), details]]);
    const title = await tmdbProvider.getDetails('603', 'movie', ctxFor(fetchJson));
    expect(title!.images).toEqual({
      poster: `${TMDB_IMG}/w500/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg`,
      backdrop: `${TMDB_IMG}/original/tlm8UkiQsitc8rSuIAscQDCnP8d.jpg`,
      card: `${TMDB_IMG}/w780/tlm8UkiQsitc8rSuIAscQDCnP8d.jpg`,
      cardHasTitle: false,
      logo: null,
    });
  });

  it('picks the certification for the region, preferring theatrical, with a US fallback', async () => {
    const maturity = async (region: string) => {
      const { fetchJson } = fakeFetch(routes());
      return (await tmdbProvider.getDetails('603', 'movie', ctxFor(fetchJson, { region })))!.maturity;
    };
    expect(await maturity('DE')).toBe('16');
    expect(await maturity('de')).toBe('16');
    expect(await maturity('GB')).toBe('15');
    expect(await maturity('FR')).toBe('R');
    expect(await maturity('JP')).toBe('R');
  });

  it('maps show details', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    const title = await tmdbProvider.getDetails('1396', 'show', ctxFor(fetchJson));
    expect(calls[0]!.url.pathname).toBe('/3/tv/1396');
    expect(calls[0]!.url.searchParams.get('append_to_response')).toBe(
      'credits,content_ratings,images,keywords,external_ids',
    );
    expect(title).toMatchObject({
      providerId: '1396',
      kind: 'show',
      name: 'Breaking Bad',
      originalName: 'Breaking Bad',
      year: 2008,
      releaseDate: '2008-01-20',
      tagline: 'Change the equation.',
      genres: ['Drama', 'Crime'],
      rating: 8.9,
      maturity: 'TV-MA',
      // episode_run_time is empty: last_episode_to_air.runtime is used.
      runtime: 56,
      tags: ['Drug Dealer', 'Money Laundering', 'Psychopath', 'High School Teacher', 'Suspenseful'],
      directors: [],
      writers: [],
      creators: ['Vince Gilligan'],
      studios: ['AMC', 'Sony Pictures Television Studios', 'High Bridge Productions'],
      externalIds: { tmdb: 1396, imdb: 'tt0903747', tvdb: 81189 },
    });
    expect(title!.cast.map((c) => c.name)).toEqual(['Bryan Cranston', 'Aaron Paul', 'Anna Gunn', 'RJ Mitte']);
    expect(title!.cast[3]!.photo).toBeNull();
    expect(title!.images).toEqual({
      poster: `${TMDB_IMG}/w500/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg`,
      backdrop: `${TMDB_IMG}/original/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg`,
      card: `${TMDB_IMG}/w780/eSzpy96DwBujGFj0xMbXBcGcfxX.jpg`,
      cardHasTitle: true,
      logo: `${TMDB_IMG}/w500/ggFHVNu6YYI5L9pCfOacjizRGt.png`,
    });
    expect(title!.seasons).toEqual({
      '0': { name: 'Specials', overview: '', poster: `${TMDB_IMG}/w342/40dT79mDEZwXkQiZNBgSaydQFDP.jpg` },
      '1': {
        name: 'Season 1',
        overview: expect.stringContaining('Street-savvy former student Jesse Pinkman "teaches" Walter a new trade.'),
        poster: `${TMDB_IMG}/w342/1BP4xYv9ZG4ZVHkL7ocOziBbSYH.jpg`,
      },
      '2': expect.objectContaining({ name: 'Season 2' }),
      '3': { name: 'Season 3', overview: 'Walt continues to battle dueling identities.', poster: null },
    });

    const { fetchJson: germanFetch } = fakeFetch(routes());
    expect((await tmdbProvider.getDetails('1396', 'show', ctxFor(germanFetch, { region: 'DE' })))!.maturity).toBe('16');
    const { fetchJson: frenchFetch } = fakeFetch(routes());
    expect((await tmdbProvider.getDetails('1396', 'show', ctxFor(frenchFetch, { region: 'FR' })))!.maturity).toBe('TV-MA');
  });

  it('fetches season episodes and skips seasons that fail', async () => {
    const { fetchJson, calls } = fakeFetch([
      [tmdbRoute('/tv/1396/season/2'), new HttpError(500, 'https://api.themoviedb.org/3/tv/1396/season/2')],
      ...routes(),
    ]);
    const episodes = await tmdbProvider.getEpisodes!('1396', [1, 2], ctxFor(fetchJson));
    expect(calls.map((c) => c.url.pathname).sort()).toEqual(['/3/tv/1396/season/1', '/3/tv/1396/season/2']);
    expect(episodes).toHaveLength(3);
    expect(episodes[0]).toEqual({
      season: 1,
      episode: 1,
      name: 'Pilot',
      overview: expect.stringMatching(/^When an unassuming high school chemistry teacher/),
      still: `${TMDB_IMG}/w300/ydlY3iPfeOAvu8gVqrxPoMvzNCn.jpg`,
      airDate: '2008-01-20',
      runtime: 58,
    });
    expect(episodes[2]).toEqual({
      season: 1,
      episode: 3,
      name: "...And the Bag's in the River",
      overview: '',
      still: null,
      airDate: '2008-02-10',
      runtime: null,
    });
  });

  it('treats missing seasons as empty but throws when every season fails', async () => {
    const { fetchJson } = fakeFetch(routes());
    await expect(tmdbProvider.getEpisodes!('1396', [9], ctxFor(fetchJson))).resolves.toEqual([]);

    const { fetchJson: failing } = fakeFetch([[tmdbRoute('/tv/1396/season/1'), new NetworkError('tmdb', 'fetch failed')]]);
    await expect(tmdbProvider.getEpisodes!('1396', [1], ctxFor(failing))).rejects.toBeInstanceOf(NetworkError);
  });

  it('finds titles by IMDb or TVDB id', async () => {
    const { fetchJson } = fakeFetch(routes());
    const ctx = ctxFor(fetchJson);
    expect(await tmdbProvider.findByExternalId!({ imdb: 'tt0903747' }, 'show', ctx)).toBe('1396');
    expect(await tmdbProvider.findByExternalId!({ imdb: 'tt0133093' }, 'movie', ctx)).toBe('603');
    expect(await tmdbProvider.findByExternalId!({ imdb: 'tt0133093' }, 'show', ctx)).toBeNull();
    expect(await tmdbProvider.findByExternalId!({ imdb: 'tt9999999', tvdb: 81189 }, 'show', ctx)).toBe('1396');
  });

  it('returns null for unknown or malformed ids', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    expect(await tmdbProvider.getDetails('999999', 'movie', ctxFor(fetchJson))).toBeNull();
    expect(await tmdbProvider.getDetails('../603', 'movie', ctxFor(fetchJson))).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TVmaze
// ---------------------------------------------------------------------------

describe('tvmaze provider', () => {
  const TVMAZE_IMG = 'https://static.tvmaze.com/uploads/images';
  const routes = (): Route[] => [
    [tvmazeRoute('/search/shows', { q: 'Breaking Bad' }), fixture('tvmaze-search-breaking-bad')],
    [tvmazeRoute('/shows/169'), fixture('tvmaze-show-169')],
    [tvmazeRoute('/shows/169/images'), fixture('tvmaze-show-169-images')],
    [tvmazeRoute('/shows/169/cast'), fixture('tvmaze-show-169-cast')],
    [tvmazeRoute('/shows/169/crew'), fixture('tvmaze-show-169-crew')],
    [tvmazeRoute('/shows/169/seasons'), fixture('tvmaze-show-169-seasons')],
    [tvmazeRoute('/shows/169/episodes'), fixture('tvmaze-show-169-episodes')],
    [tvmazeRoute('/lookup/shows', { imdb: 'tt0903747' }), fixture('tvmaze-show-169')],
  ];

  it('supports shows only and follows the setting', () => {
    expect(tvmazeProvider.supports('show')).toBe(true);
    expect(tvmazeProvider.supports('movie')).toBe(false);
    expect(tvmazeProvider.isEnabled(settings({ useTvmaze: false }))).toBe(false);
  });

  it('searches shows', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    const results = await tvmazeProvider.search({ kind: 'show', name: 'Breaking Bad', year: 2008 }, ctxFor(fetchJson));
    expect(calls[0]!.init?.limiter).toBe('tvmaze');
    expect(results).toEqual([
      {
        provider: 'tvmaze',
        id: '169',
        kind: 'show',
        name: 'Breaking Bad',
        originalName: null,
        year: 2008,
        overview:
          'Breaking Bad follows protagonist Walter White, a chemistry teacher who lives in New Mexico with his wife and teenage son who has cerebral palsy. White is diagnosed with Stage III cancer and given a prognosis of two years left to live.',
        poster: `${TVMAZE_IMG}/medium_portrait/501/1253519.jpg`,
        popularity: 98,
      },
      {
        provider: 'tvmaze',
        id: '33320',
        kind: 'show',
        name: 'Breaking Bad: Original Minisodes',
        originalName: null,
        year: 2009,
        overview: '',
        poster: null,
        popularity: 25,
      },
    ]);
    expect(await tvmazeProvider.search({ kind: 'movie', name: 'Breaking Bad' }, ctxFor(fetchJson))).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('maps show details with images, cast, crew and seasons', async () => {
    const { fetchJson } = fakeFetch(routes());
    const title = await tvmazeProvider.getDetails('169', 'show', ctxFor(fetchJson));
    expect(title).toMatchObject({
      provider: 'tvmaze',
      providerId: '169',
      kind: 'show',
      name: 'Breaking Bad',
      originalName: null,
      year: 2008,
      releaseDate: '2008-01-20',
      tagline: null,
      genres: ['Drama', 'Crime', 'Thriller'],
      tags: [],
      rating: 9.2,
      voteCount: null,
      popularity: 98,
      maturity: null,
      runtime: 62,
      directors: [],
      writers: [],
      creators: ['Vince Gilligan'],
      studios: ['AMC'],
      externalIds: { tvmaze: 169, imdb: 'tt0903747', tvdb: 81189 },
    });
    expect(title!.overview).toContain("secure his family's financial security");
    expect(title!.overview).toContain('drugs & crime.');
    expect(title!.overview).not.toMatch(/<|&amp;|&#39;/);
    expect(title!.images).toEqual({
      poster: `${TVMAZE_IMG}/original_untouched/501/1253519.jpg`,
      // The main background wins over a larger secondary one.
      backdrop: `${TVMAZE_IMG}/original_untouched/57/144330.jpg`,
      card: `${TVMAZE_IMG}/medium_landscape/57/144330.jpg`,
      cardHasTitle: false,
      logo: `${TVMAZE_IMG}/original_untouched/208/522111.png`,
    });
    expect(title!.cast).toEqual([
      { name: 'Bryan Cranston', character: 'Walter White', photo: `${TVMAZE_IMG}/medium_portrait/0/1815.jpg` },
      { name: 'Aaron Paul', character: 'Jesse Pinkman', photo: `${TVMAZE_IMG}/medium_portrait/0/1816.jpg` },
      { name: 'RJ Mitte', character: 'Walter White Jr.', photo: null },
    ]);
    expect(title!.seasons).toEqual({
      '1': { name: 'Season 1', overview: '', poster: `${TVMAZE_IMG}/original_untouched/24/60941.jpg` },
      '2': { name: 'Season 2', overview: 'Walt & Jesse face the consequences of their choices.', poster: null },
    });
  });

  it('still matches when the secondary requests fail', async () => {
    const boom = new HttpError(500, 'https://api.tvmaze.com/...');
    const { fetchJson } = fakeFetch([
      [tvmazeRoute('/shows/169/images'), boom],
      [tvmazeRoute('/shows/169/cast'), new NetworkError('https://api.tvmaze.com/shows/169/cast', 'timed out')],
      [tvmazeRoute('/shows/169/crew'), boom],
      [tvmazeRoute('/shows/169/seasons'), boom],
      ...routes(),
    ]);
    const title = await tvmazeProvider.getDetails('169', 'show', ctxFor(fetchJson));
    expect(title).toMatchObject({ name: 'Breaking Bad', cast: [], creators: [], seasons: {} });
    expect(title!.images).toEqual({
      poster: `${TVMAZE_IMG}/original_untouched/501/1253519.jpg`,
      backdrop: null,
      card: null,
      cardHasTitle: false,
      logo: null,
    });
  });

  it('returns episodes of the requested seasons only', async () => {
    const { fetchJson } = fakeFetch(routes());
    const episodes = await tvmazeProvider.getEpisodes!('169', [1, 2], ctxFor(fetchJson));
    expect(episodes).toEqual([
      {
        season: 1,
        episode: 1,
        name: 'Pilot',
        overview: expect.stringMatching(/^When an unassuming high school chemistry teacher .* once he is gone\.$/),
        still: `${TVMAZE_IMG}/original_untouched/15/38208.jpg`,
        airDate: '2008-01-20',
        runtime: 60,
      },
      {
        season: 1,
        episode: 2,
        name: "Cat's in the Bag...",
        overview: 'Walt and Jesse attempt to tie up loose ends.',
        still: `${TVMAZE_IMG}/medium_landscape/15/38209.jpg`,
        airDate: '2008-01-27',
        runtime: 60,
      },
      {
        season: 2,
        episode: 1,
        name: 'Seven Thirty-Seven',
        overview: '',
        still: null,
        airDate: '2009-03-08',
        runtime: 60,
      },
    ]);
  });

  it('looks shows up by external id', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    const ctx = ctxFor(fetchJson);
    expect(await tvmazeProvider.findByExternalId!({ imdb: 'tt0903747' }, 'show', ctx)).toBe('169');
    expect(await tvmazeProvider.findByExternalId!({ tvdb: 12345 }, 'show', ctx)).toBeNull();
    expect(calls.at(-1)!.url.searchParams.get('thetvdb')).toBe('12345');
    expect(await tvmazeProvider.findByExternalId!({ imdb: 'tt0903747' }, 'movie', ctx)).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// iTunes
// ---------------------------------------------------------------------------

describe('itunes provider', () => {
  const MZ = 'https://is1-ssl.mzstatic.com/image/thumb';

  it('upscales artwork and parses season numbers', () => {
    expect(upscaleArtwork(`${MZ}/Video/v4/aa/source/100x100bb.jpg`, '600x900bb')).toBe(`${MZ}/Video/v4/aa/source/600x900bb.jpg`);
    expect(upscaleArtwork(`${MZ}/Music/v4/bb/source/60x60bb.png`, '600x600bb')).toBe(`${MZ}/Music/v4/bb/source/600x600bb.jpg`);
    expect(upscaleArtwork(null, '600x600bb')).toBeNull();

    expect(parseSeasonNumber('Breaking Bad, Season 3')).toBe(3);
    expect(parseSeasonNumber('Dark, Staffel 3')).toBe(3);
    expect(parseSeasonNumber('Engrenages, Saison 12')).toBe(12);
    expect(parseSeasonNumber('Doctor Who, Series 1')).toBe(1);
    expect(parseSeasonNumber('24, Season 8')).toBe(8);
    expect(parseSeasonNumber('The Office, 9')).toBe(9);
    expect(parseSeasonNumber('Breaking Bad: The Final Season')).toBeNull();
    expect(parseSeasonNumber(undefined)).toBeNull();
  });

  it('searches movies in the configured store', async () => {
    const { fetchJson, calls } = fakeFetch([[itunesRoute('/search', { media: 'movie' }), fixture('itunes-search-movie-matrix')]]);
    const results = await itunesProvider.search({ kind: 'movie', name: 'The Matrix', year: 1999 }, ctxFor(fetchJson));
    const { url, init } = calls[0]!;
    expect(Object.fromEntries(url.searchParams)).toEqual({
      term: 'The Matrix',
      media: 'movie',
      entity: 'movie',
      limit: '15',
      country: 'us',
    });
    expect(init?.limiter).toBe('itunes');
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      provider: 'itunes',
      id: '271469518',
      kind: 'movie',
      name: 'The Matrix',
      originalName: null,
      year: 1999,
      overview: expect.stringMatching(/^Thomas Anderson, a computer programmer/),
      poster: `${MZ}/Video114/v4/0d/a1/67/0da16784-8bd7-3c5e-bd63-e1d9c1462d6f/pr_source.lsr/600x900bb.jpg`,
      popularity: null,
    });
    expect(results[2]).toMatchObject({ name: 'The Matrix Revolutions', year: 2003, overview: '' });
  });

  it('maps movie details', async () => {
    const { fetchJson } = fakeFetch([[itunesRoute('/lookup', { id: '271469518' }), fixture('itunes-lookup-movie-271469518')]]);
    const title = await itunesProvider.getDetails('271469518', 'movie', ctxFor(fetchJson));
    expect(title).toMatchObject({
      provider: 'itunes',
      providerId: '271469518',
      kind: 'movie',
      name: 'The Matrix',
      year: 1999,
      releaseDate: '1999-03-31',
      genres: ['Action & Adventure'],
      maturity: 'R',
      runtime: 136,
      directors: ['Lana Wachowski', 'Lilly Wachowski'],
      externalIds: { itunes: 271469518 },
      images: {
        poster: `${MZ}/Video114/v4/0d/a1/67/0da16784-8bd7-3c5e-bd63-e1d9c1462d6f/pr_source.lsr/600x900bb.jpg`,
        backdrop: null,
        card: null,
        cardHasTitle: false,
        logo: null,
      },
    });
    // A movie id looked up as a show yields nothing.
    expect(await itunesProvider.getDetails('271469518', 'show', ctxFor(fetchJson))).toBeNull();
  });

  it('groups season results into one candidate per show', async () => {
    const { fetchJson, calls } = fakeFetch([[itunesRoute('/search', { media: 'tvShow' }), fixture('itunes-search-tv-breaking-bad')]]);
    const results = await itunesProvider.search({ kind: 'show', name: 'Breaking Bad' }, ctxFor(fetchJson, { region: 'de' }));
    expect(calls[0]!.url.searchParams.get('entity')).toBe('tvSeason');
    expect(calls[0]!.url.searchParams.get('limit')).toBe('25');
    expect(calls[0]!.url.searchParams.get('country')).toBe('de');
    expect(results).toEqual([
      {
        provider: 'itunes',
        id: '271383858',
        kind: 'show',
        name: 'Breaking Bad',
        originalName: null,
        // From Season 1 even though Season 2 came first.
        year: 2008,
        overview: expect.stringMatching(/^Emmy® winner Bryan Cranston stars as Walter White/),
        poster: `${MZ}/Music/v4/23/d9/5b/23d95b5d-8e1a-2f73-9d4e-3d7b0b0a2b50/source/600x600bb.jpg`,
        popularity: null,
      },
      {
        provider: 'itunes',
        id: '1440832436',
        kind: 'show',
        name: 'Breaking Bad: Original Minisodes',
        originalName: null,
        year: 2009,
        overview: '',
        poster: `${MZ}/Video128/v4/aa/10/b2/aa10b2f1-2c11-9f09-3ab5-1f6f7d2dc1a2/source/600x600bb.jpg`,
        popularity: null,
      },
    ]);
  });

  it('maps show details from the artist lookup', async () => {
    const { fetchJson, calls } = fakeFetch([
      [itunesRoute('/lookup', { id: '271383858', entity: 'tvSeason' }), fixture('itunes-lookup-show-271383858')],
    ]);
    const title = await itunesProvider.getDetails('271383858', 'show', ctxFor(fetchJson));
    expect(calls[0]!.url.searchParams.get('limit')).toBe('200');
    expect(title).toMatchObject({
      provider: 'itunes',
      providerId: '271383858',
      kind: 'show',
      name: 'Breaking Bad',
      year: 2008,
      releaseDate: '2008-01-20',
      genres: ['Drama'],
      maturity: 'TV-MA',
      externalIds: { itunes: 271383858 },
      images: { poster: `${MZ}/Music/v4/23/d9/5b/23d95b5d-8e1a-2f73-9d4e-3d7b0b0a2b50/source/600x600bb.jpg` },
    });
    expect(title!.overview).toMatch(/^Emmy® winner Bryan Cranston/);
    // "Breaking Bad: The Final Season" has no season number and is ignored.
    expect(Object.keys(title!.seasons)).toEqual(['1', '2', '5']);
    expect(title!.seasons['2']).toEqual({
      name: 'Season 2',
      overview: expect.stringMatching(/^In Season 2 of this Emmy® Award-winning series/),
      poster: `${MZ}/Music/v4/7c/1d/64/7c1d64d9-8fd0-8f5f-fc9e-1c1f3b0a6c6d/source/600x600bb.jpg`,
    });
  });

  it('fetches episodes through the season collections', async () => {
    const { fetchJson, calls } = fakeFetch([
      [itunesRoute('/lookup', { id: '271383858', entity: 'tvSeason' }), fixture('itunes-lookup-show-271383858')],
      [itunesRoute('/lookup', { id: '271383859', entity: 'tvEpisode' }), fixture('itunes-lookup-season-271383859-episodes')],
    ]);
    const episodes = await itunesProvider.getEpisodes!('271383858', [1, 7], ctxFor(fetchJson));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.url.searchParams.get('limit')).toBe('200');
    expect(episodes).toEqual([
      {
        season: 1,
        episode: 1,
        name: 'Pilot',
        overview: expect.stringMatching(/^When an unassuming high school chemistry teacher/),
        still: `${MZ}/Video/v4/2b/8f/aa/2b8faa3b-8e3f-4b90-5d4a-5ffd2ddf5a1e/source/600x600bb.jpg`,
        airDate: '2008-01-20',
        runtime: 58,
      },
      {
        season: 1,
        episode: 2,
        name: "Cat's In the Bag...",
        overview: 'Walt and Jesse attempt to tie up loose ends.',
        still: null,
        airDate: '2008-01-27',
        runtime: 48,
      },
      {
        season: 1,
        episode: 3,
        name: "...And the Bag's In the River",
        overview: 'Walter fights with Jesse over his drug use.',
        still: null,
        airDate: '2008-02-10',
        runtime: null,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// OMDb
// ---------------------------------------------------------------------------

describe('omdb provider', () => {
  const routes = (): Route[] => [
    [omdbRoute({ s: 'The Matrix', type: 'movie' }), fixture('omdb-search-movie-matrix')],
    [omdbRoute({ s: 'Breaking Bad', type: 'series' }), fixture('omdb-search-series-breaking-bad')],
    [omdbRoute({ i: 'tt0133093' }), fixture('omdb-movie-tt0133093')],
    [omdbRoute({ i: 'tt0137523' }), fixture('omdb-movie-tt0137523')],
    [omdbRoute({ i: 'tt4154756' }), fixture('omdb-movie-tt4154756-na')],
    [omdbRoute({ i: 'tt0903747', Season: '1' }), fixture('omdb-series-tt0903747-season-1')],
    [omdbRoute({ i: 'tt0903747' }), fixture('omdb-series-tt0903747')],
    [omdbRoute({}), fixture('omdb-not-found')],
  ];

  it('is enabled by an API key', () => {
    expect(omdbProvider.isEnabled(settings())).toBe(true);
    expect(omdbProvider.isEnabled(settings({ omdbApiKey: '' }))).toBe(false);
  });

  it('searches by type and year', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    const results = await omdbProvider.search({ kind: 'movie', name: 'The Matrix', year: 1999 }, ctxFor(fetchJson));
    expect(Object.fromEntries(calls[0]!.url.searchParams)).toEqual({ apikey: 'omdbkey1', s: 'The Matrix', type: 'movie', y: '1999' });
    expect(calls[0]!.init?.limiter).toBe('omdb');
    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({
      provider: 'omdb',
      id: 'tt0133093',
      kind: 'movie',
      name: 'The Matrix',
      originalName: null,
      year: 1999,
      overview: '',
      poster: expect.stringMatching(/_V1_SX300\.jpg$/),
      popularity: null,
    });
    expect(results[3]).toMatchObject({ name: 'The Matrix Revisited', poster: null });
  });

  it('parses series year ranges', async () => {
    const { fetchJson } = fakeFetch(routes());
    const results = await omdbProvider.search({ kind: 'show', name: 'Breaking Bad' }, ctxFor(fetchJson));
    expect(results.map((r) => [r.id, r.year])).toEqual([
      ['tt0903747', 2008],
      ['tt1587000', 2009],
    ]);
  });

  it('returns nothing for "not found" answers', async () => {
    const { fetchJson } = fakeFetch(routes());
    expect(await omdbProvider.search({ kind: 'movie', name: 'Nothing Like This' }, ctxFor(fetchJson))).toEqual([]);
    expect(await omdbProvider.getDetails('tt0000001', 'movie', ctxFor(fetchJson))).toBeNull();
  });

  it('maps movie details', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    const title = await omdbProvider.getDetails('tt0133093', 'movie', ctxFor(fetchJson));
    expect(calls[0]!.url.searchParams.get('plot')).toBe('full');
    expect(title).toEqual({
      provider: 'omdb',
      providerId: 'tt0133093',
      kind: 'movie',
      name: 'The Matrix',
      originalName: null,
      year: 1999,
      releaseDate: '1999-03-31',
      overview: expect.stringMatching(/^When a beautiful stranger leads computer hacker Neo/),
      tagline: null,
      genres: ['Action', 'Sci-Fi'],
      tags: [],
      rating: 8.7,
      voteCount: 2089000,
      popularity: null,
      maturity: 'R',
      runtime: 136,
      images: {
        poster: expect.stringMatching(/_V1_SX1000\.jpg$/),
        backdrop: null,
        card: null,
        cardHasTitle: false,
        logo: null,
      },
      cast: [
        { name: 'Keanu Reeves', character: null, photo: null },
        { name: 'Laurence Fishburne', character: null, photo: null },
        { name: 'Carrie-Anne Moss', character: null, photo: null },
      ],
      directors: ['Lana Wachowski', 'Lilly Wachowski'],
      writers: ['Lilly Wachowski', 'Lana Wachowski'],
      creators: [],
      studios: [],
      externalIds: { imdb: 'tt0133093' },
      seasons: {},
    });
  });

  it('strips parenthetical writer credits', async () => {
    const { fetchJson } = fakeFetch(routes());
    const title = await omdbProvider.getDetails('tt0137523', 'movie', ctxFor(fetchJson));
    expect(title!.writers).toEqual(['Chuck Palahniuk', 'Jim Uhls']);
    expect(title!.studios).toEqual(['20th Century Fox', 'Regency Enterprises']);
  });

  it('treats N/A as missing', async () => {
    const { fetchJson } = fakeFetch(routes());
    const title = await omdbProvider.getDetails('tt4154756', 'movie', ctxFor(fetchJson));
    expect(title).toMatchObject({
      name: 'Backyard Fireworks',
      year: 2015,
      releaseDate: null,
      overview: '',
      genres: [],
      rating: null,
      voteCount: null,
      maturity: null,
      runtime: null,
      cast: [],
      directors: [],
      writers: [],
      studios: [],
      images: { poster: null },
    });
  });

  it('maps series details and rejects a kind mismatch', async () => {
    const { fetchJson } = fakeFetch(routes());
    const title = await omdbProvider.getDetails('tt0903747', 'show', ctxFor(fetchJson));
    expect(title).toMatchObject({
      kind: 'show',
      name: 'Breaking Bad',
      year: 2008,
      releaseDate: '2008-01-20',
      maturity: 'TV-MA',
      runtime: 49,
      rating: 9.5,
      voteCount: 2178432,
      directors: [],
      writers: [],
      creators: ['Vince Gilligan'],
    });
    expect(await omdbProvider.getDetails('tt0903747', 'movie', ctxFor(fetchJson))).toBeNull();
  });

  it('lists season episodes', async () => {
    const { fetchJson } = fakeFetch(routes());
    const episodes = await omdbProvider.getEpisodes!('tt0903747', [1], ctxFor(fetchJson));
    expect(episodes).toEqual([
      { season: 1, episode: 1, name: 'Pilot', overview: '', still: null, airDate: '2008-01-20', runtime: null },
      { season: 1, episode: 2, name: "Cat's in the Bag...", overview: '', still: null, airDate: '2008-01-27', runtime: null },
      { season: 1, episode: 3, name: "...And the Bag's in the River", overview: '', still: null, airDate: null, runtime: null },
    ]);
  });

  it('uses the IMDb id as its own id', async () => {
    const { fetchJson, calls } = fakeFetch(routes());
    expect(await omdbProvider.findByExternalId!({ imdb: 'tt0903747' }, 'show', ctxFor(fetchJson))).toBe('tt0903747');
    expect(await omdbProvider.findByExternalId!({ tvdb: 81189 }, 'show', ctxFor(fetchJson))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('reports key and quota problems as ProviderAuthError', async () => {
    const invalidKey = new Response(JSON.stringify({ Response: 'False', Error: 'Invalid API key!' }), { status: 401 });
    const fetchJson = createFetchJson({ fetchImpl: (async () => invalidKey.clone()) as typeof fetch, retryBaseMs: 1 });
    const error = await omdbProvider.search({ kind: 'movie', name: 'The Matrix' }, ctxFor(fetchJson)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderAuthError);
    expect((error as Error).message).toContain('Invalid API key!');
    expect((error as Error).message).not.toContain('omdbkey1');

    const { fetchJson: limited } = fakeFetch([[omdbRoute({}), { Response: 'False', Error: 'Request limit reached!' }]]);
    await expect(omdbProvider.getDetails('tt0133093', 'movie', ctxFor(limited))).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it('parses OMDb dates', () => {
    expect(parseOmdbDate('31 Mar 1999')).toBe('1999-03-31');
    expect(parseOmdbDate('5 Sep 2020')).toBe('2020-09-05');
    expect(parseOmdbDate('N/A')).toBeNull();
    expect(parseOmdbDate(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

describe('MetadataService', () => {
  const knownRoutes = (): Route[] => [
    [tmdbRoute('/search/movie', { query: 'The Matrix' }), fixture('tmdb-search-movie-matrix')],
    [tmdbRoute('/movie/603'), fixture('tmdb-movie-603')],
    [tmdbRoute('/search/tv', { query: 'Breaking Bad' }), fixture('tmdb-search-tv-breaking-bad')],
    [tmdbRoute('/tv/1396'), fixture('tmdb-tv-1396')],
    [tmdbRoute('/tv/1396/season/1'), fixture('tmdb-tv-1396-season-1')],
    [tmdbRoute('/find/tt0903747'), fixture('tmdb-find-tt0903747')],
    [tmdbRoute('/find/tt0133093'), fixture('tmdb-find-tt0133093')],
    [tvmazeRoute('/search/shows', { q: 'Breaking Bad' }), fixture('tvmaze-search-breaking-bad')],
    [tvmazeRoute('/shows/169'), fixture('tvmaze-show-169')],
    [tvmazeRoute('/shows/169/images'), fixture('tvmaze-show-169-images')],
    [tvmazeRoute('/shows/169/cast'), fixture('tvmaze-show-169-cast')],
    [tvmazeRoute('/shows/169/crew'), fixture('tvmaze-show-169-crew')],
    [tvmazeRoute('/shows/169/seasons'), fixture('tvmaze-show-169-seasons')],
    [tvmazeRoute('/shows/169/episodes'), fixture('tvmaze-show-169-episodes')],
    [omdbRoute({ s: 'The Matrix', type: 'movie' }), fixture('omdb-search-movie-matrix')],
    [omdbRoute({ s: 'Breaking Bad', type: 'series' }), fixture('omdb-search-series-breaking-bad')],
    [omdbRoute({ i: 'tt0133093' }), fixture('omdb-movie-tt0133093')],
    [omdbRoute({ i: 'tt0903747', Season: '1' }), fixture('omdb-series-tt0903747-season-1')],
    [omdbRoute({ i: 'tt0903747' }), fixture('omdb-series-tt0903747')],
    [itunesRoute('/search', { term: 'The Matrix', media: 'movie' }), fixture('itunes-search-movie-matrix')],
    [itunesRoute('/lookup', { id: '271469518' }), fixture('itunes-lookup-movie-271469518')],
    [itunesRoute('/search', { term: 'Breaking Bad', media: 'tvShow' }), fixture('itunes-search-tv-breaking-bad')],
    [itunesRoute('/lookup', { id: '271383858' }), fixture('itunes-lookup-show-271383858')],
    [itunesRoute('/lookup', { id: '271383859' }), fixture('itunes-lookup-season-271383859-episodes')],
  ];
  /** What the APIs answer for searches without results. */
  const emptySearches = (): Route[] => [
    [tmdbRoute('/search/movie'), fixture('tmdb-search-empty')],
    [tmdbRoute('/search/tv'), fixture('tmdb-search-empty')],
    [tvmazeRoute('/search/shows'), []],
    [itunesRoute('/search'), { resultCount: 0, results: [] }],
    [omdbRoute({}), fixture('omdb-not-found')],
  ];

  function setup(overrides: Partial<SettingsDTO> = {}, extraRoutes: Route[] = []) {
    const fake = fakeFetch([...extraRoutes, ...knownRoutes(), ...emptySearches()]);
    const service = new MetadataService({ getSettings: () => settings(overrides), fetchJson: fake.fetchJson });
    const callsTo = (host: string) => fake.calls.filter((c) => c.url.hostname === host);
    return { service, calls: fake.calls, callsTo };
  }

  it('orders the enabled providers per kind', () => {
    const { service } = setup();
    expect(service.enabledProviders('movie').map((p) => p.id)).toEqual(['tmdb', 'omdb', 'itunes']);
    expect(service.enabledProviders('show').map((p) => p.id)).toEqual(['tmdb', 'tvmaze', 'omdb', 'itunes']);
    const { service: limited } = setup({ tmdbApiKey: '', useItunes: false });
    expect(limited.enabledProviders('movie').map((p) => p.id)).toEqual(['omdb']);
    expect(limited.enabledProviders('show').map((p) => p.id)).toEqual(['tvmaze', 'omdb']);
  });

  it('identifies a movie by searching TMDB', async () => {
    const { service, calls } = setup();
    const result = await service.identify({ kind: 'movie', name: 'The Matrix', year: 1999, externalIds: {} });
    expect(result?.title).toMatchObject({ provider: 'tmdb', providerId: '603', name: 'The Matrix' });
    expect(result?.episodes).toEqual([]);
    expect(calls.map((c) => c.url.pathname)).toEqual(['/3/search/movie', '/3/movie/603']);
  });

  it('identifies a show with episodes of the requested seasons', async () => {
    const { service } = setup();
    const result = await service.identify({ kind: 'show', name: 'Breaking Bad', year: 2008, externalIds: {}, seasons: [1] });
    expect(result?.title).toMatchObject({ provider: 'tmdb', providerId: '1396' });
    expect(result?.episodes.map((e) => `S${e.season}E${e.episode}`)).toEqual(['S1E1', 'S1E2', 'S1E3']);
  });

  it('uses provider-native ids before anything else', async () => {
    const { service, calls } = setup();
    const movie = await service.identify({ kind: 'movie', name: 'Unrelated Name', year: null, externalIds: { tmdb: 603 } });
    expect(movie?.title.providerId).toBe('603');
    expect(calls.map((c) => c.url.pathname)).toEqual(['/3/movie/603']);

    const { service: second, callsTo } = setup();
    const show = await second.identify({ kind: 'show', name: 'Unrelated', year: null, externalIds: { tvmaze: 169 } });
    expect(show?.title).toMatchObject({ provider: 'tvmaze', providerId: '169' });
    expect(callsTo('api.themoviedb.org')).toHaveLength(0);
  });

  it('resolves IMDb ids through the providers', async () => {
    const { service, calls } = setup();
    const result = await service.identify({ kind: 'show', name: 'BB', year: null, externalIds: { imdb: 'tt0903747' } });
    expect(result?.title).toMatchObject({ provider: 'tmdb', providerId: '1396' });
    expect(calls[0]!.url.pathname).toBe('/3/find/tt0903747');

    const { service: noTmdb } = setup({ tmdbApiKey: '', useTvmaze: false });
    const viaOmdb = await noTmdb.identify({ kind: 'movie', name: 'x', year: null, externalIds: { imdb: 'tt0133093' } });
    expect(viaOmdb?.title).toMatchObject({ provider: 'omdb', providerId: 'tt0133093' });
  });

  it('retries a search without the year when the year filter finds nothing', async () => {
    const { service, callsTo } = setup({}, [
      [tmdbRoute('/search/movie', { query: 'The Matrix', year: '2000' }), fixture('tmdb-search-empty')],
    ]);
    const result = await service.identify({ kind: 'movie', name: 'The Matrix', year: 2000, externalIds: {} });
    expect(result?.title.providerId).toBe('603');
    const searches = callsTo('api.themoviedb.org').filter((c) => c.url.pathname === '/3/search/movie');
    expect(searches.map((c) => c.url.searchParams.get('year'))).toEqual(['2000', null]);
  });

  it('does not accept a candidate whose year is far off', async () => {
    const { service } = setup({ omdbApiKey: '', useItunes: false });
    expect(await service.identify({ kind: 'movie', name: 'The Matrix', year: 1985, externalIds: {} })).toBeNull();
  });

  it('falls back to TVmaze for shows when TMDB is not configured', async () => {
    const { service, callsTo } = setup({ tmdbApiKey: '' });
    const result = await service.identify({ kind: 'show', name: 'Breaking Bad', year: 2008, externalIds: {}, seasons: [1, 2] });
    expect(result?.title).toMatchObject({ provider: 'tvmaze', providerId: '169', name: 'Breaking Bad' });
    expect(result?.episodes.map((e) => `S${e.season}E${e.episode}`)).toEqual(['S1E1', 'S1E2', 'S2E1']);
    expect(callsTo('api.themoviedb.org')).toHaveLength(0);
  });

  it('falls back to OMDb, then iTunes, for movies', async () => {
    const { service } = setup({ tmdbApiKey: '' });
    expect((await service.identify({ kind: 'movie', name: 'The Matrix', year: 1999, externalIds: {} }))?.title).toMatchObject({
      provider: 'omdb',
      providerId: 'tt0133093',
    });
    const { service: storeOnly } = setup({ tmdbApiKey: '', omdbApiKey: '' });
    expect((await storeOnly.identify({ kind: 'movie', name: 'The Matrix', year: 1999, externalIds: {} }))?.title).toMatchObject({
      provider: 'itunes',
      providerId: '271469518',
    });
  });

  it('moves to the next provider when one has no confident match', async () => {
    const { service } = setup({}, [[tmdbRoute('/search/tv', { query: 'Breaking Bad' }), fixture('tmdb-search-empty')]]);
    const result = await service.identify({ kind: 'show', name: 'Breaking Bad', year: 2008, externalIds: {} });
    expect(result?.title.provider).toBe('tvmaze');
  });

  it('returns null when nothing matches and no provider failed', async () => {
    const { service } = setup();
    expect(await service.identify({ kind: 'movie', name: 'Our Wedding Video', year: 2015, externalIds: {} })).toBeNull();
    expect(await service.identify({ kind: 'show', name: 'Holiday Clips', year: null, externalIds: {} })).toBeNull();
  });

  it('returns null without any request when no provider is enabled', async () => {
    const { service, calls } = setup({ tmdbApiKey: '', omdbApiKey: '', useTvmaze: false, useItunes: false });
    expect(await service.identify({ kind: 'movie', name: 'The Matrix', year: 1999, externalIds: {} })).toBeNull();
    expect(await service.searchAll({ kind: 'show', name: 'Breaking Bad' })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('throws MetadataUnavailableError when nothing matched and a provider failed', async () => {
    const { service } = setup({ omdbApiKey: '', useItunes: false }, [
      [tmdbRoute('/search/tv'), new HttpError(503, 'https://api.themoviedb.org/3/search/tv?api_key=***')],
    ]);
    const error = await service
      .identify({ kind: 'show', name: 'Some Show', year: 2019, externalIds: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MetadataUnavailableError);
    expect((error as MetadataUnavailableError).failures.map((f) => f.provider)).toEqual(['tmdb']);
    expect((error as Error).message).toContain('tmdb: HTTP 503');

    const { service: badKey } = setup({ omdbApiKey: '', useItunes: false, useTvmaze: false }, [
      [tmdbRoute('/search/movie'), new ProviderAuthError(401, 'https://api.themoviedb.org/3/search/movie?api_key=***')],
    ]);
    await expect(
      badKey.identify({ kind: 'movie', name: 'The Matrix', year: 1999, externalIds: {} }),
    ).rejects.toBeInstanceOf(MetadataUnavailableError);
  });

  it('skips a failing provider and still matches with the next one', async () => {
    const { service, callsTo } = setup({}, [
      [tmdbRoute('/search/tv'), new NetworkError('https://api.themoviedb.org/3/search/tv', 'timed out after 15000 ms')],
    ]);
    const result = await service.identify({ kind: 'show', name: 'Breaking Bad', year: 2008, externalIds: {} });
    expect(result?.title.provider).toBe('tvmaze');
    // TMDB is not retried (e.g. without the year) once it failed.
    expect(callsTo('api.themoviedb.org')).toHaveLength(1);
  });

  it('keeps the match when episode metadata fails', async () => {
    const { service } = setup({}, [
      [tmdbRoute('/tv/1396/season/1'), new HttpError(500, 'https://api.themoviedb.org/3/tv/1396/season/1')],
    ]);
    const result = await service.identify({ kind: 'show', name: 'Breaking Bad', year: 2008, externalIds: {}, seasons: [1] });
    expect(result?.title.providerId).toBe('1396');
    expect(result?.episodes).toEqual([]);
  });

  it('searchAll merges every provider, best first', async () => {
    const { service } = setup();
    const results = await service.searchAll({ kind: 'movie', name: 'The Matrix', year: 1999 });
    expect(results).toHaveLength(12);
    expect(results.slice(0, 3).map((r) => [r.provider, r.name, r.year, r.score])).toEqual([
      ['tmdb', 'The Matrix', 1999, 1],
      ['omdb', 'The Matrix', 1999, 1],
      ['itunes', 'The Matrix', 1999, 1],
    ]);
    const scores = results.map((r) => r.score!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.every((s) => s >= 0 && s <= 1)).toBe(true);
    expect(Object.keys(results[0]!).sort()).toEqual(['id', 'kind', 'name', 'overview', 'poster', 'provider', 'score', 'year']);
  });

  it('searchAll ignores failing providers', async () => {
    const { service } = setup({}, [[tmdbRoute('/search/tv'), new HttpError(500, 'https://api.themoviedb.org/3/search/tv')]]);
    const results = await service.searchAll({ kind: 'show', name: 'Breaking Bad' });
    expect(new Set(results.map((r) => r.provider))).toEqual(new Set(['tvmaze', 'omdb', 'itunes']));
    expect(results[0]).toMatchObject({ name: 'Breaking Bad', score: 1 });
  });

  it('fetches a specific provider entry', async () => {
    const { service } = setup();
    const show = await service.fetch('tvmaze', '169', 'show', [1]);
    expect(show?.title).toMatchObject({ provider: 'tvmaze', name: 'Breaking Bad' });
    expect(show?.episodes).toHaveLength(2);
    expect((await service.fetch('tmdb', '603', 'movie'))?.title.name).toBe('The Matrix');
    expect(await service.fetch('tvmaze', '169', 'movie')).toBeNull();

    const { service: disabled } = setup({ useTvmaze: false });
    await expect(disabled.fetch('tvmaze', '169', 'show')).rejects.toThrow(/disabled/);
  });

  it('loads episodes of more seasons and lets errors through', async () => {
    const { service } = setup({}, [
      [tvmazeRoute('/shows/169/episodes'), new HttpError(502, 'https://api.tvmaze.com/shows/169/episodes')],
    ]);
    expect(await service.episodes('tmdb', '1396', [1])).toHaveLength(3);
    expect(await service.episodes('tmdb', '1396', [])).toEqual([]);
    await expect(service.episodes('tvmaze', '169', [1])).rejects.toBeInstanceOf(HttpError);
  });
});
