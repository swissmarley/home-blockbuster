import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Services } from '../services.js';
import { body } from './util.js';

const COOKIE = 'hb_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function signature(secret: string, password: string, issuedAt: string): string {
  const pwHash = createHash('sha256').update(password).digest('hex');
  return createHmac('sha256', secret).update(`${issuedAt}:${pwHash}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function isAuthenticated(services: Services, req: Request): boolean {
  const password = services.config.password;
  if (!password) return true;
  const token = readCookie(req, COOKIE);
  if (!token) return false;
  const [issuedAt, sig] = token.split('.');
  if (!issuedAt || !sig) return false;
  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return false;
  return safeEqual(sig, signature(services.db.state.data.secret, password, issuedAt));
}

/** Guards /api/* when HB_PASSWORD is set. The SPA shell itself stays public so it can show the sign-in page. */
export function authGuard(services: Services) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!services.config.password) return next();
    const open = req.path === '/health' || req.path.startsWith('/auth/');
    if (open || isAuthenticated(services, req)) return next();
    res.status(401).json({ error: 'Sign in required' });
  };
}

export function authRoutes(services: Services): Router {
  const router = Router();
  const attempts = new Map<string, { count: number; until: number }>();

  router.get('/auth/status', (req, res) => {
    res.json({ required: Boolean(services.config.password), authenticated: isAuthenticated(services, req) });
  });

  router.post('/auth/login', (req, res) => {
    const password = services.config.password;
    if (!password) {
      res.json({ ok: true });
      return;
    }
    const ip = req.ip ?? 'unknown';
    const entry = attempts.get(ip);
    if (entry && entry.count >= 5 && entry.until > Date.now()) {
      res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
      return;
    }
    const given = String(body<{ password: string }>(req).password ?? '');
    const ok = safeEqual(createHash('sha256').update(given).digest('hex'), createHash('sha256').update(password).digest('hex'));
    if (!ok) {
      const next = { count: (entry && entry.until > Date.now() ? entry.count : 0) + 1, until: Date.now() + 60_000 };
      attempts.set(ip, next);
      res.status(401).json({ error: 'Incorrect password.' });
      return;
    }
    attempts.delete(ip);
    const issuedAt = String(Date.now());
    const token = `${issuedAt}.${signature(services.db.state.data.secret, password, issuedAt)}`;
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
    );
    res.json({ ok: true });
  });

  router.post('/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    res.json({ ok: true });
  });

  return router;
}
