import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SettingsDTO } from './shared/types.js';
import type { LibraryData, StateData, StoredProfile } from './types.js';
import { randomId, randomSecret } from './util/ids.js';
import { createLogger } from './util/log.js';

const log = createLogger('db');

/**
 * A JSON document persisted to disk with debounced, atomic writes
 * (write to a temp file, then rename over the original).
 */
export class JsonStore<T> {
  data!: T;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(
    readonly file: string,
    private readonly defaults: () => T,
    private readonly migrate: (raw: unknown) => T,
    private readonly debounceMs = 800,
  ) {}

  async load(): Promise<void> {
    let raw: string | null = null;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    if (raw === null) {
      this.data = this.defaults();
      this.dirty = true;
      await this.flush();
      return;
    }
    try {
      this.data = this.migrate(JSON.parse(raw));
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      log.error(`Could not parse ${this.file}; moving it to ${backup} and starting fresh`, err);
      await fs.rename(this.file, backup).catch(() => undefined);
      this.data = this.defaults();
      this.dirty = true;
      await this.flush();
    }
  }

  /** Schedule a write. */
  save(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Write immediately (waits for any in-flight write). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writing = this.writing.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      const tmp = `${this.file}.${process.pid}.tmp`;
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.writeFile(tmp, JSON.stringify(this.data), 'utf8');
        await fs.rename(tmp, this.file);
      } catch (err) {
        this.dirty = true;
        log.error(`Failed to write ${this.file}`, err);
      }
    });
    return this.writing;
  }
}

export const LIBRARY_VERSION = 1;
export const STATE_VERSION = 1;

export function defaultSettings(): SettingsDTO {
  return {
    tmdbApiKey: '',
    omdbApiKey: '',
    metadataLanguage: 'en-US',
    region: 'US',
    useTvmaze: true,
    useItunes: true,
    autoScanMinutes: 360,
    transcoding: true,
    hwAccel: 'none',
    generateThumbnails: true,
  };
}

export function newProfile(name: string, avatar: string, kids = false): StoredProfile {
  return {
    id: randomId(),
    name,
    avatar,
    kids,
    autoplayNext: true,
    autoplayPreviews: true,
    subtitleLang: null,
    createdAt: Date.now(),
    state: { myList: [], ratings: {}, progress: {}, hiddenFromContinue: [] },
  };
}

function defaultState(): StateData {
  return {
    version: STATE_VERSION,
    settings: defaultSettings(),
    libraries: [],
    profiles: [newProfile('Me', 'smile-blue'), newProfile('Kids', 'kids-rainbow', true)],
    onboarded: false,
    secret: randomSecret(),
  };
}

function defaultLibrary(): LibraryData {
  return { version: LIBRARY_VERSION, files: {}, titles: {}, groups: {} };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function migrateState(raw: unknown): StateData {
  if (!isObject(raw)) throw new Error('state.json is not an object');
  const base = defaultState();
  const data = raw as Partial<StateData>;
  const profiles = Array.isArray(data.profiles) ? data.profiles : base.profiles;
  return {
    version: STATE_VERSION,
    settings: { ...base.settings, ...(isObject(data.settings) ? data.settings : {}) },
    libraries: Array.isArray(data.libraries) ? data.libraries : [],
    profiles: profiles.map((p) => ({
      ...newProfile(p.name ?? 'Profile', p.avatar ?? 'smile-blue', Boolean(p.kids)),
      ...p,
      state: {
        myList: p.state?.myList ?? [],
        ratings: p.state?.ratings ?? {},
        progress: p.state?.progress ?? {},
        hiddenFromContinue: p.state?.hiddenFromContinue ?? [],
      },
    })),
    onboarded: Boolean(data.onboarded),
    secret: typeof data.secret === 'string' && data.secret.length >= 32 ? data.secret : base.secret,
  };
}

function migrateLibrary(raw: unknown): LibraryData {
  if (!isObject(raw)) throw new Error('library.json is not an object');
  const data = raw as Partial<LibraryData>;
  return {
    version: LIBRARY_VERSION,
    files: isObject(data.files) ? (data.files as LibraryData['files']) : {},
    titles: isObject(data.titles) ? (data.titles as LibraryData['titles']) : {},
    groups: isObject(data.groups) ? (data.groups as LibraryData['groups']) : {},
  };
}

/** Two documents: the (large, rarely changing) media library and the (small, chatty) user state. */
export class Database {
  readonly library: JsonStore<LibraryData>;
  readonly state: JsonStore<StateData>;

  constructor(dataDir: string) {
    this.library = new JsonStore(path.join(dataDir, 'library.json'), defaultLibrary, migrateLibrary, 1500);
    this.state = new JsonStore(path.join(dataDir, 'state.json'), defaultState, migrateState, 500);
  }

  async load(): Promise<void> {
    await Promise.all([this.library.load(), this.state.load()]);
  }

  async flush(): Promise<void> {
    await Promise.all([this.library.flush(), this.state.flush()]);
  }
}
