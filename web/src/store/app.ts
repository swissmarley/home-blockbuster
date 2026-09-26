import { create } from 'zustand';
import type {
  ContinueItem,
  LibraryDTO,
  ProfileDTO,
  ProfileState,
  ScanProgress,
  SystemInfo,
  ThumbRating,
  TitleSummary,
} from '@shared/types';
import { api, onUnauthorized } from '../api/client';

const PROFILE_KEY = 'hb.profile';

function readProfileId(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}

function writeProfileId(id: string | null): void {
  try {
    if (id) localStorage.setItem(PROFILE_KEY, id);
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // storage unavailable (private mode)
  }
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error' | 'success';
}

interface AppState {
  ready: boolean;
  auth: { required: boolean; authenticated: boolean };
  system: SystemInfo | null;
  titles: TitleSummary[];
  titleMap: Record<string, TitleSummary>;
  titlesLoaded: boolean;
  libraries: LibraryDTO[];
  scan: ScanProgress | null;
  profiles: ProfileDTO[];
  profileId: string | null;
  profileState: ProfileState | null;
  continueItems: ContinueItem[];
  toasts: Toast[];
  /** The surface (billboard, hover card, modal) currently allowed to play a muted preview. */
  activePreview: string | null;

  init(): Promise<void>;
  loadSystem(): Promise<void>;
  loadTitles(): Promise<void>;
  loadLibraries(): Promise<void>;
  loadProfiles(): Promise<void>;
  selectProfile(id: string | null): Promise<void>;
  refreshProfileData(): Promise<void>;
  toggleMyList(titleId: string): Promise<void>;
  rate(titleId: string, rating: ThumbRating | 0): Promise<void>;
  hideContinue(titleId: string): Promise<void>;
  setScan(progress: ScanProgress): void;
  toast(message: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
  setActivePreview(id: string | null): void;
  setAuthenticated(value: boolean): void;
}

let toastSeq = 0;

export const useApp = create<AppState>()((set, get) => ({
  ready: false,
  auth: { required: false, authenticated: true },
  system: null,
  titles: [],
  titleMap: {},
  titlesLoaded: false,
  libraries: [],
  scan: null,
  profiles: [],
  profileId: null,
  profileState: null,
  continueItems: [],
  toasts: [],
  activePreview: null,

  async init() {
    onUnauthorized(() => set({ auth: { required: true, authenticated: false } }));
    try {
      const auth = await api.authStatus();
      set({ auth });
      if (auth.required && !auth.authenticated) {
        set({ ready: true });
        return;
      }
      const [system, profiles, libraries] = await Promise.all([api.system(), api.profiles(), api.libraries()]);
      const stored = readProfileId();
      const profileId = profiles.some((p) => p.id === stored) ? stored : null;
      set({ system, profiles, libraries, profileId });
      if (profileId) await get().refreshProfileData();
    } catch (err) {
      get().toast(err instanceof Error ? err.message : 'Could not load Home Blockbuster', 'error');
    } finally {
      set({ ready: true });
    }
  },

  async loadSystem() {
    set({ system: await api.system() });
  },

  async loadTitles() {
    const titles = await api.titles(get().profileId);
    const titleMap: Record<string, TitleSummary> = {};
    for (const t of titles) titleMap[t.id] = t;
    set({ titles, titleMap, titlesLoaded: true });
  },

  async loadLibraries() {
    set({ libraries: await api.libraries() });
  },

  async loadProfiles() {
    const profiles = await api.profiles();
    const { profileId } = get();
    set({ profiles, profileId: profiles.some((p) => p.id === profileId) ? profileId : null });
  },

  async selectProfile(id) {
    writeProfileId(id);
    set({ profileId: id, profileState: null, continueItems: [], titlesLoaded: false, titles: [], titleMap: {} });
    if (id) await get().refreshProfileData();
  },

  async refreshProfileData() {
    const id = get().profileId;
    if (!id) return;
    const [state, continueItems] = await Promise.all([api.profileState(id), api.continueWatching(id), get().loadTitles()]);
    if (get().profileId === id) set({ profileState: state, continueItems });
  },

  async toggleMyList(titleId) {
    const { profileId, profileState } = get();
    if (!profileId || !profileState) return;
    const inList = profileState.myList.includes(titleId);
    set({
      profileState: {
        ...profileState,
        myList: inList ? profileState.myList.filter((t) => t !== titleId) : [titleId, ...profileState.myList],
      },
    });
    try {
      const state = inList ? await api.removeFromList(profileId, titleId) : await api.addToList(profileId, titleId);
      set({ profileState: state });
    } catch (err) {
      set({ profileState });
      get().toast(err instanceof Error ? err.message : 'Could not update My List', 'error');
    }
  },

  async rate(titleId, rating) {
    const { profileId, profileState } = get();
    if (!profileId || !profileState) return;
    const ratings = { ...profileState.ratings };
    if (rating === 0) delete ratings[titleId];
    else ratings[titleId] = rating;
    set({ profileState: { ...profileState, ratings } });
    try {
      set({ profileState: await api.rate(profileId, titleId, rating) });
    } catch {
      set({ profileState });
    }
  },

  async hideContinue(titleId) {
    const { profileId, continueItems } = get();
    if (!profileId) return;
    set({ continueItems: continueItems.filter((c) => c.titleId !== titleId) });
    try {
      set({ profileState: await api.hideContinue(profileId, titleId) });
    } catch {
      set({ continueItems });
    }
  },

  setScan(progress) {
    set({ scan: progress });
  },

  toast(message, tone = 'info') {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    setTimeout(() => get().dismissToast(id), 4500);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setActivePreview(id) {
    if (get().activePreview !== id) set({ activePreview: id });
  },

  setAuthenticated(value) {
    set({ auth: { ...get().auth, authenticated: value } });
  },
}));

export function useCurrentProfile(): ProfileDTO | null {
  return useApp((s) => s.profiles.find((p) => p.id === s.profileId) ?? null);
}
