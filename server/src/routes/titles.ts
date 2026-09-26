import { Router, type Request } from 'express';
import { titleDetail, titleSummary } from '../library/present.js';
import { imageUrl } from '../media/images.js';
import type { Services } from '../services.js';
import type { ProviderId, TitleSummary } from '../shared/types.js';
import type { StoredProfile } from '../types.js';
import { ApiError, badRequest, body, notFound, param, queryNumber, queryString } from './util.js';

const KID_RATINGS = new Set([
  'G', 'PG', 'TV-Y', 'TV-Y7', 'TV-Y7-FV', 'TV-G', 'TV-PG', 'U', 'UC', 'ALL', 'AL', 'A', 'L', '0', '0+', '6', '6+', '7', '7+',
  'FSK 0', 'FSK 6', 'FSK0', 'FSK6', 'TP', 'K-7', 'E',
]);

/** Kids profiles only see titles rated for children, or unrated family/animation titles. */
export function isKidFriendly(s: Pick<TitleSummary, 'maturity' | 'genres'>): boolean {
  if (s.maturity) return KID_RATINGS.has(s.maturity.toUpperCase().trim());
  const genres = s.genres.map((g) => g.toLowerCase());
  if (genres.some((g) => /horror|thriller|crime|war|erotic/.test(g))) return false;
  return genres.some((g) => /family|kids|children|animation/.test(g));
}

export function profileFromRequest(services: Services, req: Request): StoredProfile | undefined {
  const id = queryString(req, 'profile');
  return id ? services.db.state.data.profiles.find((p) => p.id === id) : undefined;
}

export function titleRoutes(services: Services): Router {
  const router = Router();
  const { repo, scanner, metadata } = services;

  router.get('/titles', (req, res) => {
    const ctx = services.present();
    const profile = profileFromRequest(services, req);
    const out: TitleSummary[] = [];
    for (const title of repo.titles()) {
      const files = repo.filesOf(title.id);
      if (files.length === 0) continue;
      const summary = titleSummary(title, files, ctx);
      if (profile?.kids && !isKidFriendly(summary)) continue;
      out.push(summary);
    }
    res.json(out);
  });

  router.get('/titles/:id', (req, res) => {
    const title = repo.title(param(req, 'id'));
    if (!title) throw notFound('Title');
    res.json(titleDetail(title, repo.filesOf(title.id), repo.titles(), services.present()));
  });

  router.post('/titles/:id/refresh', async (req, res) => {
    const title = await scanner.refreshTitle(param(req, 'id'));
    if (!title) throw notFound('Title');
    res.json(titleDetail(title, repo.filesOf(title.id), repo.titles(), services.present()));
  });

  router.post('/titles/:id/unlock', async (req, res) => {
    const title = await scanner.unlockTitle(param(req, 'id'));
    if (!title) throw notFound('Title');
    res.json(titleDetail(title, repo.filesOf(title.id), repo.titles(), services.present()));
  });

  /** Search every enabled provider, for the "Fix match" dialog. */
  router.get('/titles/:id/candidates', async (req, res) => {
    const title = repo.title(param(req, 'id'));
    if (!title) throw notFound('Title');
    const q = queryString(req, 'q')?.trim() || title.parsedName;
    const year = queryNumber(req, 'year') ?? (queryString(req, 'q') ? null : title.parsedYear);
    const candidates = await metadata.searchAll({ kind: title.kind, name: q, year });
    res.json(candidates.map((c) => ({ ...c, poster: imageUrl(c.poster) })));
  });

  router.post('/titles/:id/match', async (req, res) => {
    const input = body<{ provider: ProviderId; id: string }>(req);
    if (!input.provider || !['tmdb', 'tvmaze', 'itunes', 'omdb'].includes(input.provider) || !input.id) {
      throw badRequest('provider and id are required');
    }
    const title = await scanner.matchTitle(param(req, 'id'), input.provider, String(input.id));
    if (!title) throw new ApiError(404, 'Could not load that match from the provider.');
    res.json(titleDetail(title, repo.filesOf(title.id), repo.titles(), services.present()));
  });

  return router;
}
