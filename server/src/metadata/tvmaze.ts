import type { ExternalIds } from '../shared/types.js';
import type {
  MetadataProvider,
  ProviderCandidate,
  ProviderContext,
  ProviderEpisode,
  SeasonMeta,
  StoredImages,
} from '../types.js';
import { createLogger } from '../util/log.js';
import { cleanText, dateOnly, defaultSeasonName, list, positive, uniq, yearFromDate } from './matching.js';

const API = 'https://api.tvmaze.com';

const log = createLogger('tvmaze');

interface TvmazeImageSet {
  medium?: string | null;
  original?: string | null;
}

interface TvmazeShow {
  id?: number;
  name?: string | null;
  type?: string | null;
  language?: string | null;
  genres?: string[] | null;
  status?: string | null;
  runtime?: number | null;
  averageRuntime?: number | null;
  premiered?: string | null;
  ended?: string | null;
  rating?: { average?: number | null } | null;
  weight?: number | null;
  network?: { name?: string | null; country?: { code?: string | null } | null } | null;
  webChannel?: { name?: string | null } | null;
  externals?: { tvrage?: number | null; thetvdb?: number | null; imdb?: string | null } | null;
  image?: TvmazeImageSet | null;
  summary?: string | null;
}

interface TvmazeResolution {
  url?: string | null;
  width?: number | null;
  height?: number | null;
}

interface TvmazeImage {
  id?: number;
  type?: string | null;
  main?: boolean | null;
  resolutions?: { original?: TvmazeResolution | null; medium?: TvmazeResolution | null } | null;
}

interface TvmazeCastCredit {
  person?: { name?: string | null; image?: TvmazeImageSet | null } | null;
  character?: { name?: string | null } | null;
}

interface TvmazeCrewCredit {
  type?: string | null;
  person?: { name?: string | null } | null;
}

interface TvmazeSeason {
  number?: number | null;
  name?: string | null;
  summary?: string | null;
  image?: TvmazeImageSet | null;
}

interface TvmazeEpisode {
  name?: string | null;
  season?: number | null;
  /** null for specials. */
  number?: number | null;
  airdate?: string | null;
  runtime?: number | null;
  image?: TvmazeImageSet | null;
  summary?: string | null;
}

const isNumericId = (id: string): boolean => /^\d+$/.test(id);

function get<T>(ctx: ProviderContext, path: string, params: Record<string, string> = {}, allow404 = false): Promise<T | null> {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return ctx.fetchJson<T>(url.toString(), { limiter: 'tvmaze', allow404 });
}

/** Secondary detail calls must never fail the whole match. */
async function optional<T>(request: Promise<T[] | null>, what: string): Promise<readonly T[]> {
  try {
    return list(await request);
  } catch (err) {
    log.warn(`Could not load ${what}`, err);
    return [];
  }
}

function toCandidate(show: TvmazeShow | null | undefined): ProviderCandidate | null {
  const name = show?.name?.trim();
  if (!show || typeof show.id !== 'number' || !name) return null;
  return {
    provider: 'tvmaze',
    id: String(show.id),
    kind: 'show',
    name,
    originalName: null,
    year: yearFromDate(show.premiered),
    overview: cleanText(show.summary),
    poster: show.image?.medium || show.image?.original || null,
    popularity: positive(show.weight),
  };
}

/** Main image first, then the largest. */
function ranked(images: readonly TvmazeImage[], type: string): TvmazeImage[] {
  return images
    .filter((img) => img.type === type && img.resolutions?.original?.url)
    .sort(
      (a, b) =>
        Number(Boolean(b.main)) - Number(Boolean(a.main)) ||
        (b.resolutions?.original?.width ?? 0) - (a.resolutions?.original?.width ?? 0),
    );
}

function pickImages(show: TvmazeShow, images: readonly TvmazeImage[]): StoredImages {
  const background = ranked(images, 'background')[0];
  const logo = images.find((img) => img.type === 'typography' && img.resolutions?.original?.url);
  return {
    poster: show.image?.original || show.image?.medium || ranked(images, 'poster')[0]?.resolutions?.original?.url || null,
    backdrop: background?.resolutions?.original?.url || null,
    card: background?.resolutions?.medium?.url || background?.resolutions?.original?.url || null,
    cardHasTitle: false,
    logo: logo?.resolutions?.original?.url || null,
  };
}

function mapSeasons(seasons: readonly TvmazeSeason[]): Record<string, SeasonMeta> {
  const out: Record<string, SeasonMeta> = {};
  for (const season of seasons) {
    if (typeof season.number !== 'number') continue;
    out[String(season.number)] = {
      name: season.name?.trim() || defaultSeasonName(season.number),
      overview: cleanText(season.summary),
      poster: season.image?.original || season.image?.medium || null,
    };
  }
  return out;
}

function externalIds(show: TvmazeShow & { id: number }): ExternalIds {
  const ids: ExternalIds = { tvmaze: show.id };
  if (show.externals?.imdb?.trim()) ids.imdb = show.externals.imdb.trim();
  if (show.externals?.thetvdb) ids.tvdb = show.externals.thetvdb;
  return ids;
}

export const tvmazeProvider: MetadataProvider = {
  id: 'tvmaze',

  supports: (kind) => kind === 'show',

  isEnabled: (settings) => Boolean(settings.useTvmaze),

  async search(query, ctx) {
    if (query.kind !== 'show') return [];
    // TVmaze has no year filter; the year only affects scoring.
    const hits = await get<Array<{ score?: number; show?: TvmazeShow | null }>>(ctx, '/search/shows', { q: query.name });
    return list(hits).flatMap((hit) => toCandidate(hit?.show) ?? []);
  },

  async getDetails(id, kind, ctx) {
    if (kind !== 'show' || !isNumericId(id)) return null;
    const show = await get<TvmazeShow>(ctx, `/shows/${id}`, {}, true);
    const name = show?.name?.trim();
    if (!show || typeof show.id !== 'number' || !name) return null;

    const [images, cast, crew, seasons] = await Promise.all([
      optional(get<TvmazeImage[]>(ctx, `/shows/${id}/images`), `images of show ${id}`),
      optional(get<TvmazeCastCredit[]>(ctx, `/shows/${id}/cast`), `cast of show ${id}`),
      optional(get<TvmazeCrewCredit[]>(ctx, `/shows/${id}/crew`), `crew of show ${id}`),
      optional(get<TvmazeSeason[]>(ctx, `/shows/${id}/seasons`), `seasons of show ${id}`),
    ]);
    const premiered = dateOnly(show.premiered);

    return {
      provider: 'tvmaze',
      providerId: String(show.id),
      kind: 'show',
      name,
      originalName: null,
      year: yearFromDate(premiered),
      releaseDate: premiered,
      overview: cleanText(show.summary),
      tagline: null,
      genres: uniq(list(show.genres)),
      tags: [],
      rating: positive(show.rating?.average),
      voteCount: null,
      popularity: positive(show.weight),
      maturity: null,
      runtime: positive(show.averageRuntime) ?? positive(show.runtime),
      images: pickImages(show, images),
      cast: cast
        .flatMap((credit) => {
          const person = credit?.person;
          const personName = person?.name?.trim();
          if (!personName) return [];
          return [
            {
              name: personName,
              character: credit.character?.name?.trim() || null,
              photo: person?.image?.medium || person?.image?.original || null,
            },
          ];
        })
        .slice(0, 15),
      directors: [],
      writers: [],
      creators: uniq(crew.filter((credit) => credit?.type === 'Creator').map((credit) => credit.person?.name)),
      studios: uniq([show.network?.name || show.webChannel?.name]),
      externalIds: externalIds(show as TvmazeShow & { id: number }),
      seasons: mapSeasons(seasons),
    };
  },

  async getEpisodes(id, seasons, ctx) {
    if (!isNumericId(id)) return [];
    const wanted = new Set(seasons);
    const episodes = await get<TvmazeEpisode[]>(ctx, `/shows/${id}/episodes`, {}, true);
    return list(episodes).flatMap((ep): ProviderEpisode[] => {
      if (typeof ep?.season !== 'number' || typeof ep.number !== 'number' || !wanted.has(ep.season)) return [];
      return [
        {
          season: ep.season,
          episode: ep.number,
          name: ep.name?.trim() ?? '',
          overview: cleanText(ep.summary),
          still: ep.image?.original || ep.image?.medium || null,
          airDate: dateOnly(ep.airdate),
          runtime: positive(ep.runtime),
        },
      ];
    });
  },

  async findByExternalId(ids, kind, ctx) {
    if (kind !== 'show') return null;
    const lookups: Array<Record<string, string>> = [];
    if (ids.imdb?.trim()) lookups.push({ imdb: ids.imdb.trim() });
    if (ids.tvdb) lookups.push({ thetvdb: String(ids.tvdb) });
    for (const params of lookups) {
      // Answers with a redirect to /shows/:id (followed by fetch), or 404.
      const show = await get<TvmazeShow>(ctx, '/lookup/shows', params, true);
      if (typeof show?.id === 'number') return String(show.id);
    }
    return null;
  },
};
