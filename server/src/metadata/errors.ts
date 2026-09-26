/** Non-2xx HTTP response from a metadata API. `url` is always redacted (no API keys). */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, detail?: string) {
    super(`HTTP ${status} from ${url}${detail ? `: ${detail}` : ''}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

/** 401/403: the API key is missing, invalid or over its quota. Never retried. */
export class ProviderAuthError extends HttpError {
  constructor(status: number, url: string, detail?: string) {
    super(status, url, detail ?? 'check the API key');
    this.name = 'ProviderAuthError';
  }
}

/** The request never produced an HTTP response (DNS failure, connection reset, timeout...). */
export class NetworkError extends Error {
  readonly url: string;

  constructor(url: string, reason: string, options?: { cause?: unknown }) {
    super(`Request to ${url} failed: ${reason}`, options);
    this.name = 'NetworkError';
    this.url = url;
  }
}

export interface ProviderFailure {
  provider: string;
  error: unknown;
}

/**
 * Every provider that could have answered failed with a network/HTTP error, so "no match"
 * cannot be concluded. Callers should retry later.
 */
export class MetadataUnavailableError extends Error {
  readonly failures: ProviderFailure[];

  constructor(failures: ProviderFailure[]) {
    const causes = failures.map((f) => `${f.provider}: ${errorMessage(f.error)}`).join('; ');
    super(`Metadata providers unavailable (${causes || 'unknown error'})`);
    this.name = 'MetadataUnavailableError';
    this.failures = failures;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
