import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Services } from '../services.js';
import { createLogger } from '../util/log.js';
import { ApiError, badRequest, body } from './util.js';

const log = createLogger('auth');

const COOKIE = 'hb_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 4;
const MAX_REVOKED = 500;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** "scrypt:<salt>:<hash>", stored in state.json when the password is set from the app. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function verifyHash(stored: string, given: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  return safeEqual(scryptSync(given, salt, 32).toString('hex'), hash);
}

/** Where the password comes from: HB_PASSWORD wins over one set in the app. */
export function passwordSource(services: Services): 'env' | 'app' | null {
  if (services.config.password) return 'env';
  return services.db.state.data.passwordHash ? 'app' : null;
}

export function authRequired(services: Services): boolean {
  return passwordSource(services) !== null;
}

/** Changes whenever the password changes, which invalidates every existing session. */
function passwordKey(services: Services): string | null {
  const env = services.config.password;
  if (env) return sha256(env);
  return services.db.state.data.passwordHash;
}

function checkPassword(services: Services, given: string): boolean {
  const env = services.config.password;
  if (env) return safeEqual(sha256(given), sha256(env));
  const stored = services.db.state.data.passwordHash;
  return stored ? verifyHash(stored, given) : false;
}

function signature(secret: string, key: string, issuedAt: string): string {
  return createHmac('sha256', secret).update(`${issuedAt}:${key}`).digest('hex');
}

function parseToken(req: Request): { issuedAt: string; sig: string } | null {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  const [issuedAt, sig] = token.split('.');
  return issuedAt && sig ? { issuedAt, sig } : null;
}

export function isAuthenticated(services: Services, req: Request): boolean {
  const key = passwordKey(services);
  if (!key) return true;
  const token = parseToken(req);
  if (!token) return false;
  const age = Date.now() - Number(token.issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return false;
  if (!safeEqual(token.sig, signature(services.db.state.data.secret, key, token.issuedAt))) return false;
  return !services.db.state.data.revokedSessions.some((r) => r.sig === token.sig);
}

function sessionCookie(req: Request, value: string, maxAgeSeconds: number): string {
  // req.secure honours X-Forwarded-Proto when TRUST_PROXY is configured.
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${req.secure ? '; Secure' : ''}`;
}

function issueSession(services: Services, req: Request, res: Response): void {
  const key = passwordKey(services);
  if (!key) return;
  const issuedAt = String(Date.now());
  const token = `${issuedAt}.${signature(services.db.state.data.secret, key, issuedAt)}`;
  res.setHeader('Set-Cookie', sessionCookie(req, encodeURIComponent(token), Math.floor(MAX_AGE_MS / 1000)));
}

// ---------------------------------------------------------------------------
// DNS rebinding protection
// ---------------------------------------------------------------------------

/** Host name from the raw Host header (never X-Forwarded-Host, which a rebinding page could set itself). */
function requestHost(req: Request): string | undefined {
  const header = req.headers.host?.trim();
  if (!header) return undefined;
  if (header.startsWith('[')) return header.slice(0, header.indexOf(']') + 1 || undefined);
  if (net.isIP(header)) return header;
  return header.split(':')[0];
}

const LAN_SUFFIXES = ['.localhost', '.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain', '.intranet', '.private'];

/**
 * Host names a browser can only reach this server through without DNS tricks: IP literals, localhost,
 * single-label and LAN names, plus anything in ALLOWED_HOSTS ("media.example.com" or ".example.com").
 */
export function isAllowedHost(hostname: string | undefined, allowed: string[]): boolean {
  if (!hostname) return true;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (net.isIP(host) || host === 'localhost' || !host.includes('.')) return true;
  if (LAN_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return allowed.some((entry) => {
    const e = entry.replace(/^\*\./, '.');
    return e.startsWith('.') ? host.endsWith(e) || host === e.slice(1) : host === e;
  });
}

/**
 * Without a password the API trusts anyone who can reach it, so a website could use DNS rebinding to
 * point its own domain at this server and drive the API from a visitor's browser. Refuse requests
 * addressed to unknown public host names in that case. (With a password the rebinding page has no
 * session cookie, so it gets nowhere.)
 */
export function hostGuard(services: Services) {
  const warned = new Set<string>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = requestHost(req);
    if (authRequired(services) || isAllowedHost(host, services.config.allowedHosts)) return next();
    if (host && !warned.has(host) && warned.size < 50) {
      warned.add(host);
      log.warn(`Refused a request for host "${host}". Set a password, or add it to ALLOWED_HOSTS if you use this name.`);
    }
    res
      .status(403)
      .type('text/plain')
      .send(`Home Blockbuster does not answer to "${host}" unless a password is set. Add it to ALLOWED_HOSTS or set a password.`);
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Guards /api/* when a password is set. The SPA shell itself stays public so it can show the sign-in page. */
export function authGuard(services: Services) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!authRequired(services)) return next();
    const open = req.path === '/health' || req.path.startsWith('/auth/');
    if (open || isAuthenticated(services, req)) return next();
    res.status(401).json({ error: 'Sign in required' });
  };
}

export function authRoutes(services: Services): Router {
  const router = Router();
  const { db } = services;
  const attempts = new Map<string, { count: number; until: number }>();

  const lockedOut = (req: Request): boolean => {
    const entry = attempts.get(req.ip ?? 'unknown');
    return Boolean(entry && entry.count >= 5 && entry.until > Date.now());
  };
  const recordFailure = (req: Request): void => {
    const ip = req.ip ?? 'unknown';
    const entry = attempts.get(ip);
    attempts.set(ip, { count: (entry && entry.until > Date.now() ? entry.count : 0) + 1, until: Date.now() + 60_000 });
    if (attempts.size > 1000) {
      for (const [k, v] of attempts) if (v.until <= Date.now()) attempts.delete(k);
    }
  };

  router.get('/auth/status', (req, res) => {
    res.json({ required: authRequired(services), authenticated: isAuthenticated(services, req), source: passwordSource(services) });
  });

  router.post('/auth/login', (req, res) => {
    if (!authRequired(services)) {
      res.json({ ok: true });
      return;
    }
    if (lockedOut(req)) {
      res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
      return;
    }
    const given = String(body<{ password: string }>(req).password ?? '');
    if (!checkPassword(services, given)) {
      recordFailure(req);
      res.status(401).json({ error: 'Incorrect password.' });
      return;
    }
    attempts.delete(req.ip ?? 'unknown');
    issueSession(services, req, res);
    res.json({ ok: true });
  });

  router.post('/auth/logout', (req, res) => {
    // Sessions are signed tokens, so remember this one as revoked until it would have expired anyway.
    const token = parseToken(req);
    if (token && isAuthenticated(services, req) && authRequired(services)) {
      const now = Date.now();
      const revoked = db.state.data.revokedSessions.filter((r) => r.expiresAt > now);
      revoked.push({ sig: token.sig, expiresAt: Number(token.issuedAt) + MAX_AGE_MS });
      db.state.data.revokedSessions = revoked.slice(-MAX_REVOKED);
      db.state.save();
    }
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    res.json({ ok: true });
  });

  /** Set, change or remove the app password. An empty new password removes protection. */
  router.put('/auth/password', (req, res) => {
    if (services.config.password) {
      throw new ApiError(409, 'The password is set with HB_PASSWORD on the server. Change it there.');
    }
    const input = body<{ current: string; password: string }>(req);
    if (db.state.data.passwordHash) {
      if (!isAuthenticated(services, req)) throw new ApiError(401, 'Sign in required');
      if (lockedOut(req)) throw new ApiError(429, 'Too many attempts. Try again in a minute.');
      if (!checkPassword(services, String(input.current ?? ''))) {
        recordFailure(req);
        throw new ApiError(403, 'Your current password is not correct.');
      }
    }
    const next = typeof input.password === 'string' ? input.password : '';
    if (next && next.length < MIN_PASSWORD_LENGTH) throw badRequest(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next.length > 256) throw badRequest('That password is too long.');
    db.state.data.passwordHash = next ? hashPassword(next) : null;
    db.state.data.revokedSessions = [];
    db.state.save();
    // Every other session ends with the old password; keep this browser signed in.
    if (next) issueSession(services, req, res);
    log.info(next ? 'App password changed.' : 'App password removed.');
    res.json({ required: authRequired(services), authenticated: true, source: passwordSource(services) });
  });

  return router;
}
