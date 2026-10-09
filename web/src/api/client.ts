import type {
  ContinueItem,
  FsCheckResult,
  FsListing,
  FsRoot,
  LibraryDTO,
  LibraryKind,
  MatchCandidate,
  PlaybackInfo,
  ProfileDTO,
  ProfileState,
  ProgressEntry,
  ProviderId,
  ScanProgress,
  SettingsDTO,
  SubtitleCue,
  SystemInfo,
  TitleDetail,
  TitleSummary,
} from '@shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'HomeBlockbuster',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the Home Blockbuster server.');
  }
  if (res.status === 401 && !url.startsWith('/api/auth/')) unauthorizedHandler?.();
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(url: string) => request<T>('GET', url);
const qs = (params: Record<string, string | number | boolean | null | undefined>): string => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  authStatus: () => get<{ required: boolean; authenticated: boolean }>('/api/auth/status'),
  setPassword: (current: string, password: string) =>
    request<{ required: boolean; authenticated: boolean; source: SystemInfo['authSource'] }>('PUT', '/api/auth/password', { current, password }),
  login: (password: string) => request<{ ok: boolean }>('POST', '/api/auth/login', { password }),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout'),

  system: () => get<SystemInfo>('/api/system'),
  completeOnboarding: () => request<{ ok: boolean }>('POST', '/api/onboarding/complete'),
  settings: () => get<SettingsDTO>('/api/settings'),
  saveSettings: (s: Partial<SettingsDTO>) => request<SettingsDTO>('PUT', '/api/settings', s),

  libraries: () => get<LibraryDTO[]>('/api/libraries'),
  addLibrary: (input: { name: string; path: string; kind: LibraryKind }) => request<LibraryDTO>('POST', '/api/libraries', input),
  updateLibrary: (id: string, input: Partial<{ name: string; path: string; kind: LibraryKind }>) =>
    request<LibraryDTO>('PUT', `/api/libraries/${id}`, input),
  removeLibrary: (id: string) => request<{ ok: boolean }>('DELETE', `/api/libraries/${id}`),
  scanLibrary: (id: string, refresh = false) => request<ScanProgress>('POST', `/api/libraries/${id}/scan`, { refresh }),
  scanAll: (refresh = false) => request<ScanProgress>('POST', '/api/scan', { refresh }),
  scanStatus: () => get<ScanProgress>('/api/scan'),
  refreshMetadata: (refresh = false) => request<ScanProgress>('POST', '/api/metadata/refresh', { refresh }),

  fsRoots: () => get<{ roots: FsRoot[]; separator: string; platform: string }>('/api/fs/roots'),
  fsList: (path: string) => get<FsListing>(`/api/fs/list${qs({ path })}`),
  fsCheck: (path: string) => request<FsCheckResult>('POST', '/api/fs/check', { path }),

  titles: (profileId?: string | null) => get<TitleSummary[]>(`/api/titles${qs({ profile: profileId })}`),
  title: (id: string, profileId?: string | null) => get<TitleDetail>(`/api/titles/${id}${qs({ profile: profileId })}`),
  refreshTitle: (id: string) => request<TitleDetail>('POST', `/api/titles/${id}/refresh`),
  unlockTitle: (id: string) => request<TitleDetail>('POST', `/api/titles/${id}/unlock`),
  candidates: (id: string, q?: string, year?: number | null) => get<MatchCandidate[]>(`/api/titles/${id}/candidates${qs({ q, year })}`),
  match: (id: string, provider: ProviderId, providerId: string) =>
    request<TitleDetail>('POST', `/api/titles/${id}/match`, { provider, id: providerId }),

  profiles: () => get<ProfileDTO[]>('/api/profiles'),
  createProfile: (p: Pick<ProfileDTO, 'name' | 'avatar' | 'kids'>) => request<ProfileDTO>('POST', '/api/profiles', p),
  updateProfile: (id: string, p: Partial<ProfileDTO>) => request<ProfileDTO>('PUT', `/api/profiles/${id}`, p),
  deleteProfile: (id: string) => request<{ ok: boolean }>('DELETE', `/api/profiles/${id}`),
  profileState: (id: string) => get<ProfileState>(`/api/profiles/${id}/state`),
  continueWatching: (id: string) => get<ContinueItem[]>(`/api/profiles/${id}/continue`),
  addToList: (profileId: string, titleId: string) => request<ProfileState>('PUT', `/api/profiles/${profileId}/list/${titleId}`),
  removeFromList: (profileId: string, titleId: string) =>
    request<ProfileState>('DELETE', `/api/profiles/${profileId}/list/${titleId}`),
  rate: (profileId: string, titleId: string, rating: number) =>
    request<ProfileState>('PUT', `/api/profiles/${profileId}/ratings/${titleId}`, { rating }),
  hideContinue: (profileId: string, titleId: string) =>
    request<ProfileState>('DELETE', `/api/profiles/${profileId}/continue/${titleId}`),
  progress: (profileId: string, fileId: string, position: number, duration: number, keepalive = false) =>
    request<ProgressEntry>('POST', `/api/profiles/${profileId}/progress`, { fileId, position, duration }, keepalive ? { keepalive: true } : undefined),

  playback: (fileId: string, opts: { profileId?: string | null; caps: string; audio?: number | null; force?: boolean }) =>
    get<PlaybackInfo>(
      `/api/playback/${fileId}${qs({ profile: opts.profileId, caps: opts.caps, audio: opts.audio, force: opts.force ? 1 : undefined })}`,
    ),
  keyframe: (fileId: string, t: number) => get<{ t: number }>(`/api/stream/${fileId}/keyframe${qs({ t: t.toFixed(2) })}`),
  subtitles: (fileId: string, subId: string) => get<{ cues: SubtitleCue[] }>(`/api/subtitles/${fileId}/${subId}`),
};
