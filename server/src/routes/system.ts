import { Router } from 'express';
import type { Services } from '../services.js';
import type { ServerEvent, SettingsDTO, SystemInfo } from '../shared/types.js';
import { authRequired, passwordSource } from './auth.js';
import { badRequest, body } from './util.js';

const MASK = '••••••••';

function mask(value: string): string {
  if (!value) return '';
  return `${MASK}${value.slice(-4)}`;
}

export function systemRoutes(services: Services): Router {
  const router = Router();
  const { db, config, ffmpeg, repo, events, scanner } = services;

  router.get('/health', (_req, res) => {
    res.json({ ok: true, version: config.version });
  });

  router.get('/system', (_req, res) => {
    const info: SystemInfo = {
      version: config.version,
      platform: process.platform,
      dataDir: config.dataDir,
      ffmpeg: { available: Boolean(ffmpeg.ffmpeg), version: ffmpeg.version, path: ffmpeg.ffmpeg },
      ffprobe: { available: Boolean(ffmpeg.ffprobe), path: ffmpeg.ffprobe },
      titleCount: repo.titles().length,
      fileCount: repo.files().length,
      libraryCount: db.state.data.libraries.length,
      authRequired: authRequired(services),
      authSource: passwordSource(services),
      onboarded: db.state.data.onboarded,
    };
    res.json(info);
  });

  router.post('/onboarding/complete', (_req, res) => {
    db.state.data.onboarded = true;
    db.state.save();
    res.json({ ok: true });
  });

  router.get('/settings', (_req, res) => {
    const s = services.settings();
    const out: SettingsDTO = { ...s, tmdbApiKey: mask(s.tmdbApiKey), omdbApiKey: mask(s.omdbApiKey) };
    res.json(out);
  });

  router.put('/settings', (req, res) => {
    const input = body<SettingsDTO>(req);
    const current = db.state.data.settings;
    const before = services.settings();
    const next: SettingsDTO = { ...current };

    for (const key of ['tmdbApiKey', 'omdbApiKey'] as const) {
      const value = input[key];
      if (typeof value === 'string' && !value.includes(MASK)) next[key] = value.trim();
    }
    if (typeof input.metadataLanguage === 'string') {
      if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(input.metadataLanguage)) throw badRequest('Language must look like "en-US".');
      next.metadataLanguage = input.metadataLanguage;
    }
    if (typeof input.region === 'string') {
      if (!/^[A-Z]{2}$/.test(input.region.toUpperCase())) throw badRequest('Region must be a 2-letter country code.');
      next.region = input.region.toUpperCase();
    }
    for (const key of ['useTvmaze', 'useItunes', 'transcoding', 'generateThumbnails'] as const) {
      if (typeof input[key] === 'boolean') next[key] = input[key];
    }
    if (typeof input.autoScanMinutes === 'number' && input.autoScanMinutes >= 0) {
      next.autoScanMinutes = Math.min(7 * 24 * 60, Math.round(input.autoScanMinutes));
    }
    if (input.hwAccel && ['none', 'vaapi', 'nvenc', 'qsv', 'videotoolbox'].includes(input.hwAccel)) next.hwAccel = input.hwAccel;

    db.state.data.settings = next;
    db.state.save();

    const after = services.settings();
    const providersChanged =
      before.tmdbApiKey !== after.tmdbApiKey ||
      before.omdbApiKey !== after.omdbApiKey ||
      before.useTvmaze !== after.useTvmaze ||
      before.useItunes !== after.useItunes;
    const localeChanged = before.metadataLanguage !== after.metadataLanguage || before.region !== after.region;
    if (providersChanged || localeChanged) {
      scanner.enqueueMetadata({ retryUnmatched: true, refresh: localeChanged });
    }
    res.json({ ...after, tmdbApiKey: mask(after.tmdbApiKey), omdbApiKey: mask(after.omdbApiKey) });
  });

  // Server-Sent Events: scan progress and library change notifications.
  router.get('/events', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: ServerEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: 'hello', at: Date.now() });
    send({ type: 'scan', progress: scanner.status() });
    const unsubscribe = events.subscribe(send);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  return router;
}
