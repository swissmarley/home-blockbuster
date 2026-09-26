import type { FetchJson } from '../types.js';
import { sleep } from '../util/concurrency.js';
import { createLogger } from '../util/log.js';
import { HttpError, NetworkError, ProviderAuthError } from './errors.js';

export interface RateLimit {
  /** Requests allowed within one window. */
  max: number;
  /** Window length in milliseconds. */
  perMs: number;
}

/** Budgets kept safely below each API's published (or observed) limits. */
export const DEFAULT_RATE_LIMITS: Readonly<Record<string, RateLimit>> = {
  tmdb: { max: 35, perMs: 10_000 },
  tvmaze: { max: 18, perMs: 10_000 },
  itunes: { max: 18, perMs: 60_000 },
  omdb: { max: 10, perMs: 1_000 },
};

export const DEFAULT_USER_AGENT = 'HomeBlockbuster/1.0 (+https://github.com/swissmarley/home-blockbuster)';

export interface FetchJsonOptions {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** Per-limiter budgets, merged over DEFAULT_RATE_LIMITS. */
  limits?: Partial<Record<string, RateLimit>>;
  /** Delay before the first retry; doubles on each further retry. Default 1000 ms. */
  retryBaseMs?: number;
  /** Upper bound for a server-requested Retry-After wait. Default 30 s. */
  maxRetryAfterMs?: number;
  /** Timeout of a single attempt (headers + body). Default 15 s. */
  timeoutMs?: number;
  /** Attempts per request, including the first one. Default 3. */
  maxAttempts?: number;
}

type FetchInit = NonNullable<Parameters<FetchJson>[1]>;

const log = createLogger('http');

/** Hide API keys (`api_key=` / `apikey=` query values) before a URL reaches logs or errors. */
export function redactUrl(url: string): string {
  return url.replace(/([?&]api_?key=)[^&#]*/gi, '$1***');
}

/** Allows at most `max` request starts per sliding `perMs` window; waiters are served in FIFO order. */
class SlidingWindow {
  private readonly starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  private readonly max: number;
  private readonly perMs: number;

  constructor(limit: RateLimit) {
    this.max = Math.max(1, Math.floor(limit.max));
    this.perMs = Math.max(0, limit.perMs);
  }

  acquire(): Promise<void> {
    const turn = this.queue.then(() => this.waitForSlot());
    this.queue = turn;
    return turn;
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.starts.length > 0 && now - this.starts[0] >= this.perMs) this.starts.shift();
      if (this.starts.length < this.max) {
        this.starts.push(now);
        return;
      }
      await sleep(this.starts[0] + this.perMs - now);
    }
  }
}

/**
 * JSON GET client shared by all metadata providers: per-API rate limiting, timeouts and retries
 * (network errors, 429 and 5xx), with typed errors for everything else.
 */
export function createFetchJson(opts: FetchJsonOptions = {}): FetchJson {
  // Resolve the global lazily so tests (or polyfills) can replace it after creation.
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const retryBaseMs = opts.retryBaseMs ?? 1_000;
  const maxRetryAfterMs = opts.maxRetryAfterMs ?? 30_000;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const limits: Partial<Record<string, RateLimit>> = { ...DEFAULT_RATE_LIMITS, ...opts.limits };
  const windows = new Map<string, SlidingWindow>();

  const throttle = async (name: string | undefined): Promise<void> => {
    const limit = name ? limits[name] : undefined;
    if (!name || !limit) return;
    let bucket = windows.get(name);
    if (!bucket) windows.set(name, (bucket = new SlidingWindow(limit)));
    await bucket.acquire();
  };
  const backoff = (attempt: number): number => retryBaseMs * 2 ** (attempt - 1);

  return async <T = unknown>(url: string, init: FetchInit = {}): Promise<T | null> => {
    const safeUrl = redactUrl(url);
    const headers = { Accept: 'application/json', 'User-Agent': userAgent, ...init.headers };

    for (let attempt = 1; ; attempt++) {
      const canRetry = attempt < maxAttempts;
      await throttle(init.limiter);

      let status: number;
      let retryAfter: string | null;
      let body: string;
      try {
        const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        status = res.status;
        retryAfter = res.headers.get('retry-after');
        body = await res.text();
      } catch (err) {
        const reason = describeFailure(err, timeoutMs);
        if (!canRetry) {
          log.warn(`GET ${safeUrl} failed after ${attempt} attempt(s): ${reason}`);
          throw new NetworkError(safeUrl, reason, { cause: err });
        }
        log.debug(`GET ${safeUrl} failed (${reason}), retrying`);
        await sleep(backoff(attempt));
        continue;
      }

      if (status >= 200 && status < 300) return parseJson<T>(body, status, safeUrl);
      if (status === 404 && init.allow404) return null;

      const detail = errorDetail(body);
      if (status === 401 || status === 403) {
        log.warn(`GET ${safeUrl} was rejected with HTTP ${status}${detail ? ` (${detail})` : ''}`);
        throw new ProviderAuthError(status, safeUrl, detail);
      }
      if ((status === 429 || status >= 500) && canRetry) {
        const wait = (status === 429 ? parseRetryAfter(retryAfter, maxRetryAfterMs) : null) ?? backoff(attempt);
        log.debug(`GET ${safeUrl} returned HTTP ${status}, retrying in ${wait} ms`);
        await sleep(wait);
        continue;
      }
      const message = `GET ${safeUrl} returned HTTP ${status}${detail ? ` (${detail})` : ''}`;
      if (status === 404) log.debug(message);
      else log.warn(message);
      throw new HttpError(status, safeUrl, detail);
    }
  };
}

function parseJson<T>(body: string, status: number, url: string): T | null {
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(status, url, 'response is not valid JSON');
  }
}

/** Error text from the JSON error bodies of TMDB, OMDb, iTunes and TVmaze. */
function errorDetail(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  for (const key of ['status_message', 'Error', 'errorMessage', 'message']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return redactUrl(value.trim()).slice(0, 200);
  }
  return undefined;
}

/** Retry-After as delta-seconds or an HTTP date, capped; null when absent or unparseable. */
function parseRetryAfter(value: string | null, capMs: number): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.min(Math.max(0, ms), capMs) : null;
}

function describeFailure(err: unknown, timeoutMs: number): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === 'TimeoutError') return `timed out after ${timeoutMs} ms`;
  // undici reports "fetch failed" and puts the useful part (ECONNREFUSED, ENOTFOUND...) in `cause`.
  const cause = err.cause as { code?: unknown; message?: unknown } | null | undefined;
  const code = cause?.code ?? cause?.message;
  return code ? `${err.message} (${String(code)})` : err.message;
}
