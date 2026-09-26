import type { TitleKind } from '../shared/types.js';
import type { MetadataProvider, ProviderCandidate, ProviderContext, ProviderEpisode } from '../types.js';
import { createLogger } from '../util/log.js';
import { ProviderAuthError } from './errors.js';
import { redactUrl } from './http.js';
import { cleanText, dateOnly, list, positive, uniq, yearFromDate } from './matching.js';

const API = 'https://www.omdbapi.com/';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const log = createLogger('omdb');

/** OMDb answers HTTP 200 with `Response: "False"` and an `Error` for most failures. */
interface OmdbEnvelope {
  Response?: string;
  Error?: string;
}

interface OmdbSearchResponse extends OmdbEnvelope {
  Search?: Array<{ Title?: string; Year?: string; imdbID?: string; Type?: string; Poster?: string }> | null;
  totalResults?: string;
}

interface OmdbTitle extends OmdbEnvelope {
  Title?: string;
  Year?: string;
  Rated?: string;
  Released?: string;
  Runtime?: string;
  Genre?: string;
  Director?: string;
  Writer?: string;
  Actors?: string;
  Plot?: string;
  Poster?: string;
  imdbRating?: string;
  imdbVotes?: string;
  imdbID?: string;
  Type?: string;
  totalSeasons?: string;
  Production?: string;
}

interface OmdbSeason extends OmdbEnvelope {
  Episodes?: Array<{ Title?: string; Released?: string; Episode?: string; imdbRating?: string; imdbID?: string }> | null;
}

const isImdbId = (id: string): boolean => /^tt\d+$/.test(id);

/** OMDb's "N/A" (and blanks) as null. */
function value(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text && text.toUpperCase() !== 'N/A' ? text : null;
}

/** "Action, Sci-Fi" -> ["Action", "Sci-Fi"]. */
const splitList = (raw: unknown): string[] => uniq((value(raw) ?? '').split(','));

/** "Chuck Palahniuk (novel), Jim Uhls (screenplay)" -> ["Chuck Palahniuk", "Jim Uhls"]. */
const splitPeople = (raw: unknown): string[] => uniq(splitList(raw).map((name) => name.replace(/\s*\([^)]*\)/g, '')));

/** "31 Mar 1999" -> "1999-03-31". */
export function parseOmdbDate(raw: unknown): string | null {
  const match = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(value(raw) ?? '');
  const month = match ? MONTHS.indexOf(match[2].toLowerCase()) + 1 : 0;
  if (!match || month === 0) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

const parseNumber = (raw: unknown): number | null => positive(Number((value(raw) ?? '').replace(/,/g, '')));

const omdbType = (kind: TitleKind): string => (kind === 'movie' ? 'movie' : 'series');

async function get<T extends OmdbEnvelope>(ctx: ProviderContext, params: Record<string, string | number>): Promise<T | null> {
  const url = new URL(API);
  url.searchParams.set('apikey', (ctx.settings.omdbApiKey ?? '').trim());
  for (const [key, val] of Object.entries(params)) url.searchParams.set(key, String(val));
  const data = await ctx.fetchJson<T>(url.toString(), { limiter: 'omdb' });
  if (!data || data.Response !== 'False') return data;

  const error = value(data.Error) ?? 'unknown error';
  if (/not found|too many results|incorrect imdb id/i.test(error)) return null;
  if (/api key|request limit/i.test(error)) throw new ProviderAuthError(401, redactUrl(url.toString()), error);
  log.warn(`OMDb error: ${error}`);
  throw new Error(`OMDb: ${error}`);
}

export const omdbProvider: MetadataProvider = {
  id: 'omdb',

  supports: () => true,

  isEnabled: (settings) => Boolean(settings.omdbApiKey?.trim()),

  async search(query, ctx) {
    const type = omdbType(query.kind);
    const params: Record<string, string | number> = { s: query.name, type };
    if (query.year) params.y = query.year;
    const data = await get<OmdbSearchResponse>(ctx, params);
    return list(data?.Search).flatMap((item): ProviderCandidate[] => {
      const id = value(item?.imdbID);
      const name = value(item?.Title);
      if (!id || !name || (value(item.Type) ?? type) !== type) return [];
      return [
        {
          provider: 'omdb',
          id,
          kind: query.kind,
          name,
          originalName: null,
          year: yearFromDate(value(item.Year)),
          overview: '',
          poster: value(item.Poster),
          popularity: null,
        },
      ];
    });
  },

  async getDetails(id, kind, ctx) {
    if (!isImdbId(id)) return null;
    const data = await get<OmdbTitle>(ctx, { i: id, plot: 'full' });
    const name = value(data?.Title);
    if (!data || !name) return null;
    // An IMDb id may point at another kind of title (or an episode).
    if ((value(data.Type) ?? omdbType(kind)) !== omdbType(kind)) return null;

    const releaseDate = parseOmdbDate(data.Released);
    const writers = splitPeople(data.Writer);
    const rating = parseNumber(data.imdbRating);
    return {
      provider: 'omdb',
      providerId: value(data.imdbID) ?? id,
      kind,
      name,
      originalName: null,
      // Series years look like "2008–2013" or "2019–".
      year: yearFromDate(value(data.Year)) ?? yearFromDate(releaseDate),
      releaseDate,
      overview: cleanText(value(data.Plot)),
      tagline: null,
      genres: splitList(data.Genre),
      tags: [],
      rating,
      voteCount: parseNumber(data.imdbVotes),
      popularity: null,
      maturity: value(data.Rated),
      runtime: positive(parseInt(value(data.Runtime) ?? '', 10)),
      images: {
        poster: value(data.Poster)?.replace('SX300', 'SX1000') ?? null,
        backdrop: null,
        card: null,
        cardHasTitle: false,
        logo: null,
      },
      cast: splitPeople(data.Actors).map((actor) => ({ name: actor, character: null, photo: null })),
      directors: splitPeople(data.Director),
      // For series OMDb's "Writer" lists the creators.
      writers: kind === 'movie' ? writers.slice(0, 5) : [],
      creators: kind === 'show' ? writers : [],
      studios: splitList(data.Production).slice(0, 3),
      externalIds: { imdb: value(data.imdbID) ?? id },
      seasons: {},
    };
  },

  async getEpisodes(id, seasons, ctx) {
    if (!isImdbId(id)) return [];
    const wanted = [...new Set(seasons)];
    const results = await Promise.allSettled(
      wanted.map(async (season): Promise<ProviderEpisode[]> => {
        const data = await get<OmdbSeason>(ctx, { i: id, Season: season });
        return list(data?.Episodes).flatMap((ep) => {
          const episode = parseInt(value(ep?.Episode) ?? '', 10);
          if (!Number.isFinite(episode)) return [];
          return [
            {
              season,
              episode,
              name: value(ep.Title) ?? '',
              overview: '',
              still: null,
              airDate: dateOnly(value(ep.Released)),
              runtime: null,
            },
          ];
        });
      }),
    );
    const failures = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    for (const reason of failures) log.warn(`Episode metadata for ${id} failed`, reason);
    // Skip seasons that failed, unless all of them did: then the caller should retry later.
    if (wanted.length > 0 && failures.length === wanted.length) throw failures[0];
    return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  },

  // The IMDb id is OMDb's own id.
  async findByExternalId(ids) {
    const imdb = ids.imdb?.trim();
    return imdb && isImdbId(imdb) ? imdb : null;
  },
};
