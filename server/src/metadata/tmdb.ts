import type { CastMember, ExternalIds, SettingsDTO, TitleKind } from '../shared/types.js';
import type {
  MetadataProvider,
  ProviderCandidate,
  ProviderContext,
  ProviderEpisode,
  ProviderTitle,
  SeasonMeta,
  StoredImages,
} from '../types.js';
import { createLogger } from '../util/log.js';
import { cleanText, dateOnly, defaultSeasonName, list, positive, titleCase, uniq, yearFromDate } from './matching.js';

// Overridable to use a TMDB mirror/proxy (or a local mock in tests).
const API = process.env.TMDB_API_BASE?.replace(/\/+$/, '') || 'https://api.themoviedb.org/3';
const IMAGE_BASE = process.env.TMDB_IMAGE_BASE?.replace(/\/+$/, '') || 'https://image.tmdb.org/t/p';
const WRITER_JOBS = new Set(['Screenplay', 'Writer', 'Story', 'Novel', 'Teleplay']);

const log = createLogger('tmdb');

// Response shapes: TMDB omits or nulls fields freely, so everything is optional.
interface TmdbNamed {
  name?: string | null;
}

interface TmdbSearchResult {
  id?: number;
  title?: string | null;
  original_title?: string | null;
  release_date?: string | null;
  name?: string | null;
  original_name?: string | null;
  first_air_date?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  popularity?: number | null;
}

interface TmdbImage {
  file_path?: string | null;
  iso_639_1?: string | null;
  vote_average?: number | null;
  width?: number | null;
}

interface TmdbDetails {
  id?: number;
  imdb_id?: string | null;
  title?: string | null;
  original_title?: string | null;
  name?: string | null;
  original_name?: string | null;
  tagline?: string | null;
  overview?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  runtime?: number | null;
  episode_run_time?: number[] | null;
  last_episode_to_air?: { runtime?: number | null } | null;
  genres?: TmdbNamed[] | null;
  vote_average?: number | null;
  vote_count?: number | null;
  popularity?: number | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  production_companies?: TmdbNamed[] | null;
  networks?: TmdbNamed[] | null;
  created_by?: TmdbNamed[] | null;
  seasons?: Array<{
    season_number?: number | null;
    name?: string | null;
    overview?: string | null;
    poster_path?: string | null;
  }> | null;
  credits?: {
    cast?: Array<{ name?: string | null; character?: string | null; profile_path?: string | null; order?: number | null }> | null;
    crew?: Array<{ name?: string | null; job?: string | null; department?: string | null }> | null;
  } | null;
  release_dates?: {
    results?: Array<{
      iso_3166_1?: string | null;
      release_dates?: Array<{ certification?: string | null; type?: number | null }> | null;
    }> | null;
  } | null;
  content_ratings?: { results?: Array<{ iso_3166_1?: string | null; rating?: string | null }> | null } | null;
  images?: { backdrops?: TmdbImage[] | null; logos?: TmdbImage[] | null; posters?: TmdbImage[] | null } | null;
  /** Movies list keywords under `keywords`, TV shows under `results`. */
  keywords?: { keywords?: TmdbNamed[] | null; results?: TmdbNamed[] | null } | null;
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null } | null;
}

interface TmdbSeason {
  episodes?: Array<{
    season_number?: number | null;
    episode_number?: number | null;
    name?: string | null;
    overview?: string | null;
    still_path?: string | null;
    air_date?: string | null;
    runtime?: number | null;
  }> | null;
}

interface TmdbFindResult {
  movie_results?: Array<{ id?: number }> | null;
  tv_results?: Array<{ id?: number }> | null;
}

// ---------------------------------------------------------------------------

const language = (settings: SettingsDTO): string => settings.metadataLanguage?.trim().replace('_', '-') || 'en-US';
/** ISO 639-1 part of the metadata language, as used by TMDB image tags ("en-US" -> "en"). */
const imageLanguage = (settings: SettingsDTO): string => language(settings).split(/[-_]/)[0].toLowerCase();
const region = (settings: SettingsDTO): string => (settings.region?.trim() || 'US').toUpperCase();
/** v4 "API Read Access Tokens" are JWTs; v3 keys are 32 hex chars. */
const isBearerToken = (key: string): boolean => key.startsWith('eyJ');
const isNumericId = (id: string): boolean => /^\d+$/.test(id);

function image(size: string, path: string | null | undefined): string | null {
  if (!path) return null;
  return `${IMAGE_BASE}/${size}${path.startsWith('/') ? '' : '/'}${path}`;
}

function request<T>(
  ctx: ProviderContext,
  path: string,
  params: Record<string, string | number | null | undefined> = {},
  allow404 = false,
): Promise<T | null> {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('language', language(ctx.settings));
  const key = (ctx.settings.tmdbApiKey ?? '').trim();
  const headers: Record<string, string> = {};
  if (isBearerToken(key)) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  return ctx.fetchJson<T>(url.toString(), { limiter: 'tmdb', headers, allow404 });
}

function toCandidate(result: TmdbSearchResult, kind: TitleKind): ProviderCandidate | null {
  const movie = kind === 'movie';
  const originalName = (movie ? result.original_title : result.original_name)?.trim() || null;
  const name = (movie ? result.title : result.name)?.trim() || originalName;
  if (typeof result.id !== 'number' || !name) return null;
  return {
    provider: 'tmdb',
    id: String(result.id),
    kind,
    name,
    originalName,
    year: yearFromDate(movie ? result.release_date : result.first_air_date),
    overview: cleanText(result.overview),
    poster: image('w342', result.poster_path),
    popularity: positive(result.popularity),
  };
}

/** Highest voted, then widest; with `preferPng`, PNGs beat SVGs regardless of votes. */
function bestImage(images: readonly TmdbImage[], preferPng = false): TmdbImage | null {
  const isPng = (img: TmdbImage): number => (preferPng && /\.png$/i.test(img.file_path ?? '') ? 1 : 0);
  const ranked = images
    .filter((img) => img.file_path)
    .sort(
      (a, b) =>
        isPng(b) - isPng(a) || (b.vote_average ?? 0) - (a.vote_average ?? 0) || (b.width ?? 0) - (a.width ?? 0),
    );
  return ranked[0] ?? null;
}

const withLanguage = (images: readonly TmdbImage[], lang: string | null): TmdbImage[] =>
  images.filter((img) => (lang === null ? img.iso_639_1 === null || img.iso_639_1 === 'xx' : img.iso_639_1 === lang));

function pickImages(details: TmdbDetails, lang: string): StoredImages {
  const backdrops = list(details.images?.backdrops);
  const logos = list(details.images?.logos);
  const posters = list(details.images?.posters);

  // Language-less backdrops are the clean "textless" art; tagged ones carry the title treatment.
  const textless = bestImage(withLanguage(backdrops, null));
  const titled = bestImage(withLanguage(backdrops, lang)) ?? bestImage(withLanguage(backdrops, 'en'));
  const logo =
    bestImage(withLanguage(logos, lang), true) ??
    bestImage(withLanguage(logos, 'en'), true) ??
    bestImage(withLanguage(logos, null), true);
  const posterPath =
    details.poster_path ||
    (bestImage(withLanguage(posters, lang)) ?? bestImage(withLanguage(posters, 'en')) ?? bestImage(posters))?.file_path;
  const plainBackdrop = details.backdrop_path || textless?.file_path;

  return {
    poster: image('w500', posterPath),
    backdrop: image('original', textless?.file_path || details.backdrop_path),
    card: titled ? image('w780', titled.file_path) : image('w780', plainBackdrop),
    cardHasTitle: titled !== null,
    logo: image('w500', logo?.file_path),
  };
}

function mapCast(details: TmdbDetails): CastMember[] {
  return [...list(details.credits?.cast)]
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .flatMap((member) => {
      const name = member.name?.trim();
      return name ? [{ name, character: member.character?.trim() || null, photo: image('w185', member.profile_path) }] : [];
    })
    .slice(0, 15);
}

const names = (items: readonly TmdbNamed[] | null | undefined): string[] => uniq(list(items).map((item) => item.name));

function movieCertification(details: TmdbDetails, country: string): string | null {
  const countries = list(details.release_dates?.results);
  const forCountry = (code: string): string | null => {
    const releases = list(countries.find((c) => c.iso_3166_1?.toUpperCase() === code)?.release_dates);
    const rated = releases.filter((r) => r.certification?.trim());
    // Type 3 is the theatrical release.
    return (rated.find((r) => r.type === 3) ?? rated[0])?.certification?.trim() || null;
  };
  return forCountry(country) ?? (country === 'US' ? null : forCountry('US'));
}

function showRating(details: TmdbDetails, country: string): string | null {
  const ratings = list(details.content_ratings?.results);
  const forCountry = (code: string): string | null =>
    ratings.find((r) => r.iso_3166_1?.toUpperCase() === code && r.rating?.trim())?.rating?.trim() || null;
  return forCountry(country) ?? (country === 'US' ? null : forCountry('US'));
}

const keywordTags = (keywords: readonly TmdbNamed[] | null | undefined): string[] =>
  uniq(list(keywords).map((k) => (k.name ? titleCase(k.name) : null))).slice(0, 8);

function externalIds(ids: { tmdb?: number; imdb?: string | null; tvdb?: number | null }): ExternalIds {
  const out: ExternalIds = {};
  if (ids.tmdb) out.tmdb = ids.tmdb;
  if (ids.imdb?.trim()) out.imdb = ids.imdb.trim();
  if (ids.tvdb) out.tvdb = ids.tvdb;
  return out;
}

function mapSeasons(details: TmdbDetails): Record<string, SeasonMeta> {
  const seasons: Record<string, SeasonMeta> = {};
  for (const season of list(details.seasons)) {
    if (typeof season.season_number !== 'number') continue;
    seasons[String(season.season_number)] = {
      name: season.name?.trim() || defaultSeasonName(season.season_number),
      overview: cleanText(season.overview),
      poster: image('w342', season.poster_path),
    };
  }
  return seasons;
}

function mapTitle(details: TmdbDetails & { id: number }, kind: TitleKind, settings: SettingsDTO): ProviderTitle {
  const movie = kind === 'movie';
  const releaseDate = dateOnly(movie ? details.release_date : details.first_air_date);
  const originalName = (movie ? details.original_title : details.original_name)?.trim() || null;
  const crew = list(details.credits?.crew);
  const people = (jobs: (job: string) => boolean): string[] =>
    uniq(crew.filter((member) => jobs(member.job ?? '')).map((member) => member.name));
  const rating = positive(details.vote_average);

  return {
    provider: 'tmdb',
    providerId: String(details.id),
    kind,
    name: (movie ? details.title : details.name)?.trim() || originalName || '',
    originalName,
    year: yearFromDate(releaseDate),
    releaseDate,
    overview: cleanText(details.overview),
    tagline: details.tagline?.trim() || null,
    genres: names(details.genres),
    tags: keywordTags(movie ? details.keywords?.keywords : details.keywords?.results),
    rating: rating === null ? null : Math.round(rating * 10) / 10,
    voteCount: positive(details.vote_count),
    popularity: positive(details.popularity),
    maturity: movie ? movieCertification(details, region(settings)) : showRating(details, region(settings)),
    runtime: movie
      ? positive(details.runtime)
      : (list(details.episode_run_time).map(positive).find((n) => n !== null) ?? positive(details.last_episode_to_air?.runtime)),
    images: pickImages(details, imageLanguage(settings)),
    cast: mapCast(details),
    directors: movie ? people((job) => job === 'Director') : [],
    writers: movie ? people((job) => WRITER_JOBS.has(job)).slice(0, 5) : [],
    creators: movie ? [] : names(details.created_by),
    studios: uniq([...(movie ? [] : names(details.networks)), ...names(details.production_companies)]).slice(0, 3),
    externalIds: externalIds({
      tmdb: details.id,
      imdb: movie ? details.imdb_id : details.external_ids?.imdb_id,
      tvdb: movie ? null : details.external_ids?.tvdb_id,
    }),
    seasons: movie ? {} : mapSeasons(details),
  };
}

async function fetchSeason(id: string, season: number, ctx: ProviderContext): Promise<ProviderEpisode[]> {
  const data = await request<TmdbSeason>(ctx, `/tv/${id}/season/${season}`, {}, true);
  return list(data?.episodes).flatMap((ep) => {
    if (typeof ep.episode_number !== 'number') return [];
    return [
      {
        season: typeof ep.season_number === 'number' ? ep.season_number : season,
        episode: ep.episode_number,
        name: ep.name?.trim() ?? '',
        overview: cleanText(ep.overview),
        still: image('w300', ep.still_path),
        airDate: dateOnly(ep.air_date),
        runtime: positive(ep.runtime),
      },
    ];
  });
}

export const tmdbProvider: MetadataProvider = {
  id: 'tmdb',

  supports: () => true,

  isEnabled: (settings) => Boolean(settings.tmdbApiKey?.trim()),

  async search(query, ctx) {
    const movie = query.kind === 'movie';
    const data = await request<{ results?: TmdbSearchResult[] | null }>(ctx, movie ? '/search/movie' : '/search/tv', {
      query: query.name,
      include_adult: 'false',
      [movie ? 'year' : 'first_air_date_year']: query.year || null,
    });
    return list(data?.results).flatMap((result) => toCandidate(result, query.kind) ?? []);
  },

  async getDetails(id, kind, ctx) {
    if (!isNumericId(id)) return null;
    const append =
      kind === 'movie' ? 'credits,release_dates,images,keywords' : 'credits,content_ratings,images,keywords,external_ids';
    const details = await request<TmdbDetails>(
      ctx,
      `/${kind === 'movie' ? 'movie' : 'tv'}/${id}`,
      {
        append_to_response: append,
        include_image_language: uniq([imageLanguage(ctx.settings), 'en', 'null']).join(','),
      },
      true,
    );
    if (!details || typeof details.id !== 'number') return null;
    return mapTitle(details as TmdbDetails & { id: number }, kind, ctx.settings);
  },

  async getEpisodes(id, seasons, ctx) {
    if (!isNumericId(id)) return [];
    const wanted = [...new Set(seasons)];
    const results = await Promise.allSettled(wanted.map((season) => fetchSeason(id, season, ctx)));
    const failures = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    for (const reason of failures) log.warn(`Episode metadata for tv/${id} failed`, reason);
    // Skip seasons that failed, unless all of them did: then the caller should retry later.
    if (wanted.length > 0 && failures.length === wanted.length) throw failures[0];
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  },

  async findByExternalId(ids, kind, ctx) {
    const lookups: Array<[string, string]> = [];
    if (ids.imdb?.trim()) lookups.push([ids.imdb.trim(), 'imdb_id']);
    if (ids.tvdb) lookups.push([String(ids.tvdb), 'tvdb_id']);
    for (const [externalId, source] of lookups) {
      const data = await request<TmdbFindResult>(
        ctx,
        `/find/${encodeURIComponent(externalId)}`,
        { external_source: source },
        true,
      );
      const hit = list(kind === 'movie' ? data?.movie_results : data?.tv_results)[0];
      if (typeof hit?.id === 'number') return String(hit.id);
    }
    return null;
  },
};
