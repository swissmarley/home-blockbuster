import { Router } from 'express';
import { newProfile } from '../db.js';
import { episodeDTO, nextEpisodeFile, titleSummary } from '../library/present.js';
import type { Services } from '../services.js';
import type { ContinueItem, ProfileDTO, ProgressEntry, ThumbRating } from '../shared/types.js';
import type { StoredProfile } from '../types.js';
import { isKidFriendly } from './titles.js';
import { badRequest, body, notFound, param } from './util.js';

const MAX_PROFILES = 5;
const AVATAR = /^[a-z0-9-]{1,40}$/;

export function toProfileDTO(p: StoredProfile): ProfileDTO {
  return {
    id: p.id,
    name: p.name,
    avatar: p.avatar,
    kids: p.kids,
    autoplayNext: p.autoplayNext,
    autoplayPreviews: p.autoplayPreviews,
    subtitleLang: p.subtitleLang,
    createdAt: p.createdAt,
  };
}

/** A title counts as watched near the end (credits). */
export function isFinished(position: number, duration: number): boolean {
  if (!duration || duration <= 0) return false;
  return position / duration >= 0.94 || duration - position <= 90;
}

export function profileRoutes(services: Services): Router {
  const router = Router();
  const { db, repo } = services;
  const profiles = (): StoredProfile[] => db.state.data.profiles;
  const find = (id: string): StoredProfile => {
    const p = profiles().find((x) => x.id === id);
    if (!p) throw notFound('Profile');
    return p;
  };
  const cleanName = (name: unknown): string => {
    const value = typeof name === 'string' ? name.trim().slice(0, 30) : '';
    if (!value) throw badRequest('Please enter a name.');
    return value;
  };

  router.get('/profiles', (_req, res) => {
    res.json(profiles().map(toProfileDTO));
  });

  router.post('/profiles', (req, res) => {
    if (profiles().length >= MAX_PROFILES) throw badRequest(`You can have up to ${MAX_PROFILES} profiles.`);
    const input = body<ProfileDTO>(req);
    const name = cleanName(input.name);
    if (profiles().some((p) => p.name.toLowerCase() === name.toLowerCase())) throw badRequest('That name is already taken.');
    const avatar = typeof input.avatar === 'string' && AVATAR.test(input.avatar) ? input.avatar : 'smile-blue';
    const profile = newProfile(name, avatar, Boolean(input.kids));
    profiles().push(profile);
    db.state.save();
    res.status(201).json(toProfileDTO(profile));
  });

  router.put('/profiles/:id', (req, res) => {
    const profile = find(param(req, 'id'));
    const input = body<ProfileDTO>(req);
    if (input.name !== undefined) {
      const name = cleanName(input.name);
      if (profiles().some((p) => p.id !== profile.id && p.name.toLowerCase() === name.toLowerCase())) {
        throw badRequest('That name is already taken.');
      }
      profile.name = name;
    }
    if (typeof input.avatar === 'string' && AVATAR.test(input.avatar)) profile.avatar = input.avatar;
    for (const key of ['kids', 'autoplayNext', 'autoplayPreviews'] as const) {
      if (typeof input[key] === 'boolean') profile[key] = input[key];
    }
    if (input.subtitleLang === null || typeof input.subtitleLang === 'string') {
      profile.subtitleLang = input.subtitleLang ? input.subtitleLang.slice(0, 16) : null;
    }
    db.state.save();
    res.json(toProfileDTO(profile));
  });

  router.delete('/profiles/:id', (req, res) => {
    const id = param(req, 'id');
    if (profiles().length <= 1) throw badRequest('You need at least one profile.');
    const index = profiles().findIndex((p) => p.id === id);
    if (index < 0) throw notFound('Profile');
    profiles().splice(index, 1);
    db.state.save();
    res.json({ ok: true });
  });

  router.get('/profiles/:id/state', (req, res) => {
    res.json(find(param(req, 'id')).state);
  });

  router.put('/profiles/:id/list/:titleId', (req, res) => {
    const profile = find(param(req, 'id'));
    const titleId = param(req, 'titleId');
    if (!repo.title(titleId)) throw notFound('Title');
    profile.state.myList = [titleId, ...profile.state.myList.filter((t) => t !== titleId)];
    db.state.save();
    res.json(profile.state);
  });

  router.delete('/profiles/:id/list/:titleId', (req, res) => {
    const profile = find(param(req, 'id'));
    const titleId = param(req, 'titleId');
    profile.state.myList = profile.state.myList.filter((t) => t !== titleId);
    db.state.save();
    res.json(profile.state);
  });

  router.put('/profiles/:id/ratings/:titleId', (req, res) => {
    const profile = find(param(req, 'id'));
    const titleId = param(req, 'titleId');
    const rating = Number(body<{ rating: number }>(req).rating);
    if (rating === 0) delete profile.state.ratings[titleId];
    else if (rating === -1 || rating === 1 || rating === 2) profile.state.ratings[titleId] = rating as ThumbRating;
    else throw badRequest('rating must be -1, 0, 1 or 2');
    db.state.save();
    res.json(profile.state);
  });

  router.post('/profiles/:id/progress', (req, res) => {
    const profile = find(param(req, 'id'));
    const input = body<{ fileId: string; position: number; duration: number }>(req);
    const file = typeof input.fileId === 'string' ? repo.file(input.fileId) : undefined;
    if (!file) throw notFound('File');
    const position = Number(input.position);
    const duration = Number(input.duration) || file.probe?.duration || 0;
    if (!Number.isFinite(position) || position < 0) throw badRequest('Invalid position');
    const entry: ProgressEntry = {
      fileId: file.id,
      titleId: file.titleId,
      position: Math.round(position * 10) / 10,
      duration: Math.round(duration * 10) / 10,
      updatedAt: Date.now(),
      finished: isFinished(position, duration),
    };
    profile.state.progress[file.id] = entry;
    profile.state.hiddenFromContinue = profile.state.hiddenFromContinue.filter((t) => t !== file.titleId);
    db.state.save();
    res.json(entry);
  });

  /** Continue Watching: the latest unfinished file per title, or the next episode after a finished one. */
  router.get('/profiles/:id/continue', (req, res) => {
    const profile = find(param(req, 'id'));
    const latest = new Map<string, ProgressEntry>();
    for (const entry of Object.values(profile.state.progress)) {
      if (!repo.file(entry.fileId)) continue;
      const current = latest.get(entry.titleId);
      if (!current || entry.updatedAt > current.updatedAt) latest.set(entry.titleId, entry);
    }
    const ctx = services.present();
    const items: ContinueItem[] = [];
    for (const [titleId, entry] of latest) {
      if (profile.state.hiddenFromContinue.includes(titleId)) continue;
      const title = repo.title(titleId);
      if (!title) continue;
      const files = repo.filesOf(titleId);
      if (profile.kids && !isKidFriendly(titleSummary(title, files, ctx))) continue;
      if (!entry.finished) {
        const file = repo.file(entry.fileId)!;
        items.push({
          titleId,
          fileId: file.id,
          position: entry.position,
          duration: entry.duration,
          progress: entry.duration ? Math.min(1, entry.position / entry.duration) : 0,
          episode: title.kind === 'show' ? episodeDTO(title, file) : null,
          updatedAt: entry.updatedAt,
          upNext: false,
        });
      } else if (title.kind === 'show') {
        const next = nextEpisodeFile(files, entry.fileId);
        const nextProgress = next ? profile.state.progress[next.id] : undefined;
        if (next && !nextProgress?.finished) {
          const duration = next.probe?.duration ?? nextProgress?.duration ?? 0;
          const position = nextProgress?.position ?? 0;
          items.push({
            titleId,
            fileId: next.id,
            position,
            duration,
            progress: duration ? Math.min(1, position / duration) : 0,
            episode: episodeDTO(title, next),
            updatedAt: entry.updatedAt,
            upNext: true,
          });
        }
      }
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(items.slice(0, 40));
  });

  /** "Remove from row" in Continue Watching. */
  router.delete('/profiles/:id/continue/:titleId', (req, res) => {
    const profile = find(param(req, 'id'));
    const titleId = param(req, 'titleId');
    if (!profile.state.hiddenFromContinue.includes(titleId)) profile.state.hiddenFromContinue.push(titleId);
    db.state.save();
    res.json(profile.state);
  });

  return router;
}
