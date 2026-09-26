import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { authGuard, authRoutes } from './routes/auth.js';
import { imageRoutes } from './routes/images.js';
import { libraryRoutes } from './routes/libraries.js';
import { playbackRoutes } from './routes/playback.js';
import { profileRoutes } from './routes/profiles.js';
import { systemRoutes } from './routes/system.js';
import { titleRoutes } from './routes/titles.js';
import { ApiError } from './routes/util.js';
import type { Services } from './services.js';
import { createLogger } from './util/log.js';

const log = createLogger('http');

const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function createApp(services: Services): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const api = express.Router();
  // CSRF guard: other websites can't add custom headers to cross-origin requests without a CORS
  // preflight (which is never granted), so state-changing calls must come from our own client.
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.get('x-requested-with') === 'HomeBlockbuster') return next();
    res.status(403).json({ error: 'Missing X-Requested-With header' });
  });
  api.use(authRoutes(services));
  api.use(authGuard(services));
  api.use(systemRoutes(services));
  api.use(libraryRoutes(services));
  api.use(titleRoutes(services));
  api.use(profileRoutes(services));
  api.use(playbackRoutes(services));
  api.use(imageRoutes(services));
  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use('/api', api);

  const webDir = services.config.webDir;
  if (webDir) {
    const indexFile = path.join(webDir, 'index.html');
    app.use(
      express.static(webDir, {
        index: false,
        setHeaders(res, file) {
          const hashed = file.includes(`${path.sep}assets${path.sep}`);
          res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
        },
      }),
    );
    // Single-page app: every other GET renders the client.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Security-Policy', CSP);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('text/plain')
        .send('Home Blockbuster API is running. Build the web client with "npm run build", or use "npm run dev" during development.');
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let status = 500;
    let message = 'Something went wrong on the server.';
    if (err instanceof ApiError) {
      status = err.status;
      message = err.message;
    } else if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed') {
      status = 400;
      message = 'Invalid JSON body';
    } else {
      log.error('Unhandled error', err);
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(status).json({ error: message });
  });

  return app;
}
