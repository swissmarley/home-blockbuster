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
import { cleanText, dateOnly, defaultSeasonName, list, positive, uniq, yearFromDate } from './matching.js';

const API = 'https://itunes.apple.com';
const MOVIE_ARTWORK = '600x900bb';
const SEASON_ARTWORK = '600x600bb';

const log = createLogger('itunes');

/** Search/lookup results mix artists, collections (TV seasons) and tracks (movies, episodes). */
interface ItunesItem {
  wrapperType?: string | null;
  kind?: string | null;
  collectionType?: string | null;
  trackId?: number | null;
  trackName?: string | null;
  trackNumber?: number | null;
  artistId?: number | null;
  artistName?: string | null;
  collectionId?: number | null;
  collectionName?: string | null;
  releaseDate?: string | null;
  primaryGenreName?: string | null;
  contentAdvisoryRating?: string | null;
  shortDescription?: string | null;
  longDescription?: string | null;
  description?: string | null;
  trackTimeMillis?: number | null;
  artworkUrl30?: string | null;
  artworkUrl60?: string | null;
  artworkUrl100?: string | null;
}

interface ItunesResponse {
  resultCount?: number;
  results?: ItunesItem[] | null;
}

interface NumberedSeason {
  number: number;
  item: ItunesItem;
}

const isNumericId = (id: string): boolean => /^\d+$/.test(id);

function get(ctx: ProviderContext, path: string, params: Record<string, string | number>): Promise<ItunesResponse | null> {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  url.searchParams.set('country', (ctx.settings.region?.trim() || 'US').toLowerCase());
  return ctx.fetchJson<ItunesResponse>(url.toString(), { limiter: 'itunes' });
}

/** Swap the size segment of an mzstatic artwork URL (".../100x100bb.jpg") for a larger one. */
export function upscaleArtwork(url: string | null | undefined, size: string): string | null {
  if (!url) return null;
  return url.replace(/\/\d+x\d+[a-z]*(?:-\d+)?\.(?:jpe?g|png|webp)$/i, `/${size}.jpg`);
}

const artwork = (item: ItunesItem | undefined, size: string): string | null =>
  upscaleArtwork(item?.artworkUrl100 || item?.artworkUrl60 || item?.artworkUrl30, size);

const minutes = (millis: number | null | undefined): number | null => {
  const ms = positive(millis);
  return ms === null ? null : Math.round(ms / 60_000);
};

const description = (item: ItunesItem | undefined): string =>
  cleanText(item?.longDescription || item?.shortDescription || item?.description);

/** "Breaking Bad, Season 3" / "Dark, Staffel 3" / "Engrenages, Saison 3" -> 3. */
export function parseSeasonNumber(collectionName: string | null | undefined): number | null {
  if (!collectionName) return null;
  const match =
    /\b(?:season|staffel|saison|series|temporada|stagione|seizoen|s[äa]song|s[æa]son|sezon)\s*(\d{1,3})\b/i.exec(
      collectionName,
    ) ?? /(\d{1,3})\s*$/.exec(collectionName.trim());
  return match ? Number(match[1]) : null;
}

/** Season label as the store localises it ("Season 3", "Staffel 3"), falling back to "Season N". */
function seasonLabel(item: ItunesItem, number: number): string {
  const name = item.collectionName?.trim() ?? '';
  const tail = name.includes(',') ? name.slice(name.lastIndexOf(',') + 1).trim() : '';
  return tail && parseSeasonNumber(tail) === number ? tail : defaultSeasonName(number);
}

const isTvSeason = (item: ItunesItem): boolean =>
  item.wrapperType === 'collection' && (!item.collectionType || item.collectionType === 'TV Season');

/** Distinct seasons ordered by number; the first occurrence of a number wins. */
function numberedSeasons(items: readonly ItunesItem[]): NumberedSeason[] {
  const seasons = new Map<number, ItunesItem>();
  for (const item of items) {
    const number = parseSeasonNumber(item.collectionName);
    if (number !== null && !seasons.has(number)) seasons.set(number, item);
  }
  return [...seasons].map(([number, item]) => ({ number, item })).sort((a, b) => a.number - b.number);
}

/** The season that represents a show: the lowest numbered one, else the earliest released. */
function firstSeason(items: readonly ItunesItem[]): ItunesItem | undefined {
  return (
    numberedSeasons(items)[0]?.item ??
    [...items].sort((a, b) => (a.releaseDate ?? '9999').localeCompare(b.releaseDate ?? '9999'))[0]
  );
}

const posterOnly = (poster: string | null): StoredImages => ({
  poster,
  backdrop: null,
  card: null,
  cardHasTitle: false,
  logo: null,
});

function movieCandidate(item: ItunesItem): ProviderCandidate | null {
  const name = item.trackName?.trim();
  if (typeof item.trackId !== 'number' || !name) return null;
  return {
    provider: 'itunes',
    id: String(item.trackId),
    kind: 'movie',
    name,
    originalName: null,
    year: yearFromDate(item.releaseDate),
    overview: description(item),
    poster: artwork(item, MOVIE_ARTWORK),
    popularity: null,
  };
}

/** Season search results grouped into one candidate per show (artistId), in relevance order. */
function showCandidates(items: readonly ItunesItem[]): ProviderCandidate[] {
  const groups = new Map<number, ItunesItem[]>();
  for (const item of items) {
    if (!isTvSeason(item) || typeof item.artistId !== 'number') continue;
    const group = groups.get(item.artistId) ?? [];
    group.push(item);
    groups.set(item.artistId, group);
  }
  return [...groups].flatMap(([artistId, seasons]): ProviderCandidate[] => {
    const first = firstSeason(seasons);
    const name = seasons.find((s) => s.artistName?.trim())?.artistName?.trim();
    if (!first || !name) return [];
    return [
      {
        provider: 'itunes',
        id: String(artistId),
        kind: 'show',
        name,
        originalName: null,
        year: yearFromDate(first.releaseDate),
        overview: description(first),
        poster: artwork(first, SEASON_ARTWORK),
        popularity: null,
      },
    ];
  });
}

const isMovie = (item: ItunesItem | undefined): item is ItunesItem =>
  item?.wrapperType === 'track' && (!item.kind || item.kind === 'feature-movie');

function mapMovie(item: ItunesItem): ProviderTitle | null {
  const candidate = movieCandidate(item);
  if (!candidate) return null;
  return {
    provider: 'itunes',
    providerId: candidate.id,
    kind: 'movie',
    name: candidate.name,
    originalName: null,
    year: candidate.year,
    releaseDate: dateOnly(item.releaseDate),
    overview: candidate.overview,
    tagline: null,
    genres: uniq([item.primaryGenreName]),
    tags: [],
    rating: null,
    voteCount: null,
    popularity: null,
    maturity: item.contentAdvisoryRating?.trim() || null,
    runtime: minutes(item.trackTimeMillis),
    images: posterOnly(candidate.poster),
    cast: [],
    // For movies the "artist" is the director ("Lana Wachowski & Lilly Wachowski").
    directors: uniq((item.artistName ?? '').split(/\s+&\s+|,\s*/)),
    writers: [],
    creators: [],
    studios: [],
    externalIds: { itunes: Number(candidate.id) },
    seasons: {},
  };
}

/** A show (artist) and its seasons, from one lookup. */
async function lookupShow(
  id: string,
  ctx: ProviderContext,
): Promise<{ artist: ItunesItem | undefined; seasons: ItunesItem[] } | null> {
  const data = await get(ctx, '/lookup', { id, entity: 'tvSeason', limit: 200 });
  const results = list(data?.results);
  const artist = results.find((item) => item.wrapperType === 'artist');
  const seasons = results.filter(isTvSeason);
  return artist || seasons.length > 0 ? { artist, seasons } : null;
}

function mapShow(id: string, artist: ItunesItem | undefined, seasons: readonly ItunesItem[]): ProviderTitle | null {
  const first = firstSeason(seasons);
  const name = artist?.artistName?.trim() || first?.artistName?.trim();
  if (!name) return null;
  const seasonMeta: Record<string, SeasonMeta> = {};
  for (const { number, item } of numberedSeasons(seasons)) {
    seasonMeta[String(number)] = {
      name: seasonLabel(item, number),
      overview: description(item),
      poster: artwork(item, SEASON_ARTWORK),
    };
  }
  return {
    provider: 'itunes',
    providerId: id,
    kind: 'show',
    name,
    originalName: null,
    year: yearFromDate(first?.releaseDate),
    releaseDate: dateOnly(first?.releaseDate),
    overview: description(first),
    tagline: null,
    genres: uniq([artist?.primaryGenreName || first?.primaryGenreName]),
    tags: [],
    rating: null,
    voteCount: null,
    popularity: null,
    maturity: first?.contentAdvisoryRating?.trim() || null,
    runtime: null,
    images: posterOnly(artwork(first, SEASON_ARTWORK)),
    cast: [],
    directors: [],
    writers: [],
    creators: [],
    studios: [],
    externalIds: { itunes: Number(id) },
    seasons: seasonMeta,
  };
}

async function seasonEpisodes(season: NumberedSeason, ctx: ProviderContext): Promise<ProviderEpisode[]> {
  const data = await get(ctx, '/lookup', { id: season.item.collectionId ?? '', entity: 'tvEpisode', limit: 200 });
  const seen = new Set<number>();
  return list(data?.results).flatMap((track): ProviderEpisode[] => {
    if (track.wrapperType !== 'track' || typeof track.trackNumber !== 'number' || seen.has(track.trackNumber)) return [];
    seen.add(track.trackNumber);
    return [
      {
        season: season.number,
        episode: track.trackNumber,
        name: track.trackName?.trim() ?? '',
        overview: description(track),
        still: artwork(track, SEASON_ARTWORK),
        airDate: dateOnly(track.releaseDate),
        runtime: minutes(track.trackTimeMillis),
      },
    ];
  });
}

export const itunesProvider: MetadataProvider = {
  id: 'itunes',

  supports: () => true,

  isEnabled: (settings) => Boolean(settings.useItunes),

  async search(query, ctx) {
    // The Search API has no year filter; the year only affects scoring.
    if (query.kind === 'movie') {
      const data = await get(ctx, '/search', { term: query.name, media: 'movie', entity: 'movie', limit: 15 });
      return list(data?.results).flatMap((item) => (isMovie(item) ? (movieCandidate(item) ?? []) : []));
    }
    const data = await get(ctx, '/search', { term: query.name, media: 'tvShow', entity: 'tvSeason', limit: 25 });
    return showCandidates(list(data?.results));
  },

  async getDetails(id, kind, ctx) {
    if (!isNumericId(id)) return null;
    if (kind === 'movie') {
      const data = await get(ctx, '/lookup', { id });
      const item = list(data?.results)[0];
      return isMovie(item) ? mapMovie(item) : null;
    }
    const show = await lookupShow(id, ctx);
    return show ? mapShow(id, show.artist, show.seasons) : null;
  },

  async getEpisodes(id, seasons, ctx) {
    if (!isNumericId(id)) return [];
    const show = await lookupShow(id, ctx);
    const wanted = new Set(seasons);
    const targets = numberedSeasons(show?.seasons ?? []).filter(
      (s) => wanted.has(s.number) && typeof s.item.collectionId === 'number',
    );
    const results = await Promise.allSettled(targets.map((season) => seasonEpisodes(season, ctx)));
    const failures = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    for (const reason of failures) log.warn(`Episode metadata for show ${id} failed`, reason);
    // Skip seasons that failed, unless all of them did: then the caller should retry later.
    if (targets.length > 0 && failures.length === targets.length) throw failures[0];
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  },
};
