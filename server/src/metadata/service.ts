import type { ExternalIds, MatchCandidate, ProviderId, SettingsDTO, TitleKind } from '../shared/types.js';
import type {
  FetchJson,
  MetadataProvider,
  ProviderCandidate,
  ProviderContext,
  ProviderEpisode,
  ProviderTitle,
  SearchQuery,
} from '../types.js';
import { createLogger } from '../util/log.js';
import { errorMessage, MetadataUnavailableError, type ProviderFailure } from './errors.js';
import { createFetchJson } from './http.js';
import { itunesProvider } from './itunes.js';
import { pickBest, scoreCandidate } from './matching.js';
import { omdbProvider } from './omdb.js';
import { tmdbProvider } from './tmdb.js';
import { tvmazeProvider } from './tvmaze.js';

export interface IdentifyInput {
  kind: TitleKind;
  name: string;
  year: number | null;
  externalIds: ExternalIds;
  /** Shows: seasons whose episode metadata should be fetched along with the match. */
  seasons?: number[];
}

export interface IdentifyResult {
  title: ProviderTitle;
  episodes: ProviderEpisode[];
}

export interface MetadataServiceOptions {
  getSettings: () => SettingsDTO;
  fetchJson?: FetchJson;
  providers?: MetadataProvider[];
}

export const DEFAULT_PROVIDERS: readonly MetadataProvider[] = [tmdbProvider, tvmazeProvider, omdbProvider, itunesProvider];

/** Preferred provider order per kind (richest metadata first). */
const PROVIDER_ORDER: Readonly<Record<TitleKind, readonly ProviderId[]>> = {
  movie: ['tmdb', 'omdb', 'itunes'],
  show: ['tmdb', 'tvmaze', 'omdb', 'itunes'],
};

/** Providers whose search filters by year server-side; only they can gain from a year-less retry. */
const YEAR_FILTERED_SEARCH: ReadonlySet<ProviderId> = new Set(['tmdb', 'omdb']);

const MAX_SEARCH_RESULTS = 25;

const log = createLogger('metadata');

function nativeId(provider: ProviderId, ids: ExternalIds): string | null {
  const id = provider === 'tmdb' ? ids.tmdb : provider === 'tvmaze' ? ids.tvmaze : provider === 'itunes' ? ids.itunes : undefined;
  return id ? String(id) : null;
}

export class MetadataService {
  private readonly getSettings: () => SettingsDTO;
  private readonly fetchJson: FetchJson;
  private readonly providers: readonly MetadataProvider[];

  constructor(opts: MetadataServiceOptions) {
    this.getSettings = opts.getSettings;
    this.fetchJson = opts.fetchJson ?? createFetchJson();
    this.providers = opts.providers ?? DEFAULT_PROVIDERS;
  }

  /** Enabled providers that support `kind`, in preference order. */
  enabledProviders(kind: TitleKind): MetadataProvider[] {
    const settings = this.getSettings();
    return PROVIDER_ORDER[kind].flatMap((id) =>
      this.providers.filter((p) => p.id === id && p.supports(kind) && p.isEnabled(settings)),
    );
  }

  /**
   * Finds and loads metadata for a title: known provider ids first, then IMDb/TVDB ids, then a
   * fuzzy search, walking providers in preference order. Resolves null when nothing matched;
   * throws MetadataUnavailableError when nothing matched but some provider failed (retry later).
   */
  async identify(input: IdentifyInput): Promise<IdentifyResult | null> {
    const providers = this.enabledProviders(input.kind);
    if (providers.length === 0) return null;
    const ctx = this.context();
    const ids = input.externalIds ?? {};
    const failures: ProviderFailure[] = [];

    // A provider that throws is skipped for the rest of this call.
    const attempt = async <T>(provider: MetadataProvider, step: string, run: () => Promise<T>): Promise<T | null> => {
      if (failures.some((f) => f.provider === provider.id)) return null;
      try {
        return await run();
      } catch (err) {
        failures.push({ provider: provider.id, error: err });
        log.warn(`${provider.id}: ${step} failed for ${input.kind} "${input.name}": ${errorMessage(err)}`);
        return null;
      }
    };
    const load = (provider: MetadataProvider, id: string): Promise<IdentifyResult | null> =>
      attempt(provider, `loading ${id}`, () => this.load(provider, id, input.kind, input.seasons, ctx));

    for (const provider of providers) {
      const id = nativeId(provider.id, ids);
      const result = id ? await load(provider, id) : null;
      if (result) return result;
    }

    if (ids.imdb || ids.tvdb) {
      for (const provider of providers) {
        if (!provider.findByExternalId) continue;
        const id = await attempt(provider, 'external id lookup', async () =>
          provider.findByExternalId ? provider.findByExternalId(ids, input.kind, ctx) : null,
        );
        const result = id ? await load(provider, id) : null;
        if (result) return result;
      }
    }

    if (input.name.trim()) {
      for (const provider of providers) {
        const match = await attempt(provider, 'search', () => this.searchBest(provider, input, ctx));
        const result = match ? await load(provider, match.id) : null;
        if (result) return result;
      }
    }

    if (failures.length > 0) throw new MetadataUnavailableError(failures);
    return null;
  }

  /** Candidates from every enabled provider, best first (for the manual "Fix match" dialog). */
  async searchAll(query: SearchQuery): Promise<MatchCandidate[]> {
    if (!query.name.trim()) return [];
    const ctx = this.context();
    const lists = await Promise.all(
      this.enabledProviders(query.kind).map(async (provider) => {
        try {
          return await provider.search(query, ctx);
        } catch (err) {
          log.warn(`${provider.id}: search for "${query.name}" failed: ${errorMessage(err)}`);
          return [];
        }
      }),
    );
    return lists
      .flat()
      .map((candidate) => ({ candidate, score: scoreCandidate(query, candidate) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SEARCH_RESULTS)
      .map(({ candidate, score }) => ({
        provider: candidate.provider,
        id: candidate.id,
        kind: candidate.kind,
        name: candidate.name,
        year: candidate.year,
        overview: candidate.overview,
        poster: candidate.poster,
        // Raw scores exceed 1 with year/exact bonuses; the client gets a 0..1 confidence.
        score: Math.round(Math.min(1, Math.max(0, score)) * 100) / 100,
      }));
  }

  /** Loads a specific provider entry (e.g. the candidate picked in "Fix match"). */
  async fetch(provider: ProviderId, id: string, kind: TitleKind, seasons?: number[]): Promise<IdentifyResult | null> {
    const impl = this.provider(provider);
    if (!impl?.supports(kind)) return null;
    return this.load(impl, id, kind, seasons, this.context());
  }

  /** Episode metadata for more seasons of an already matched show. Errors propagate. */
  async episodes(provider: ProviderId, id: string, seasons: number[]): Promise<ProviderEpisode[]> {
    const impl = this.provider(provider);
    if (!impl?.getEpisodes || seasons.length === 0) return [];
    return impl.getEpisodes(id, seasons, this.context());
  }

  private context(): ProviderContext {
    return { settings: this.getSettings(), fetchJson: this.fetchJson };
  }

  /** A configured and enabled provider; throws when it is disabled so callers retry instead of unmatching. */
  private provider(id: ProviderId): MetadataProvider | null {
    const impl = this.providers.find((p) => p.id === id);
    if (!impl) return null;
    if (!impl.isEnabled(this.getSettings())) throw new Error(`Metadata provider "${id}" is disabled`);
    return impl;
  }

  /** Searches with the year, then (for providers filtering by year) without it, still scoring against it. */
  private async searchBest(
    provider: MetadataProvider,
    input: IdentifyInput,
    ctx: ProviderContext,
  ): Promise<ProviderCandidate | null> {
    const query: SearchQuery = { kind: input.kind, name: input.name, year: input.year };
    const best = pickBest(query, await provider.search(query, ctx));
    if (best || input.year == null || !YEAR_FILTERED_SEARCH.has(provider.id)) return best;
    return pickBest(query, await provider.search({ ...query, year: null }, ctx));
  }

  private async load(
    provider: MetadataProvider,
    id: string,
    kind: TitleKind,
    seasons: number[] | undefined,
    ctx: ProviderContext,
  ): Promise<IdentifyResult | null> {
    const title = await provider.getDetails(id, kind, ctx);
    if (!title) return null;
    let episodes: ProviderEpisode[] = [];
    if (kind === 'show' && seasons?.length && provider.getEpisodes) {
      try {
        episodes = await provider.getEpisodes(title.providerId, seasons, ctx);
      } catch (err) {
        log.warn(`${provider.id}: episodes of ${title.providerId} failed: ${errorMessage(err)}`);
      }
    }
    return { title, episodes };
  }
}
