import type { JsonStore } from '../db.js';
import type { TitleKind } from '../shared/types.js';
import type { LibraryData, StoredFile, StoredTitle } from '../types.js';
import { hashId } from '../util/ids.js';
import { sortName, titleKey } from './filenameParser.js';

export function groupKey(kind: TitleKind, name: string, year: number | null): string {
  const key = titleKey(name) || name.toLowerCase();
  return kind === 'movie' ? `movie:${key}:${year ?? ''}` : `show:${key}${year ? `:${year}` : ''}`;
}

export function newTitle(kind: TitleKind, name: string, year: number | null, id: string): StoredTitle {
  const now = Date.now();
  return {
    id,
    kind,
    parsedName: name,
    parsedYear: year,
    name,
    sortName: sortName(name),
    year,
    overview: '',
    tagline: null,
    genres: [],
    tags: [],
    rating: null,
    voteCount: null,
    popularity: null,
    maturity: null,
    runtime: null,
    releaseDate: null,
    images: { poster: null, backdrop: null, card: null, cardHasTitle: false, logo: null },
    cast: [],
    directors: [],
    writers: [],
    creators: [],
    studios: [],
    externalIds: {},
    seasons: {},
    episodes: {},
    metadata: {
      status: 'pending',
      source: 'filename',
      fetchedAt: null,
      locked: false,
      error: null,
      attempts: 0,
      seasonsFetched: [],
    },
    addedAt: now,
    updatedAt: now,
  };
}

/** Indexed access to the media library document. */
export class LibraryRepo {
  private byTitle = new Map<string, Set<string>>();

  constructor(private readonly store: JsonStore<LibraryData>) {
    this.reindex();
  }

  private get data(): LibraryData {
    return this.store.data;
  }

  reindex(): void {
    this.byTitle.clear();
    for (const file of Object.values(this.data.files)) this.index(file);
    // Drop titles that lost all their files (e.g. after a crash mid-scan).
    for (const id of Object.keys(this.data.titles)) {
      if (!this.byTitle.get(id)?.size) this.deleteTitle(id);
    }
  }

  private index(file: StoredFile): void {
    let set = this.byTitle.get(file.titleId);
    if (!set) {
      set = new Set();
      this.byTitle.set(file.titleId, set);
    }
    set.add(file.id);
  }

  private unindex(file: StoredFile): void {
    this.byTitle.get(file.titleId)?.delete(file.id);
  }

  save(): void {
    this.store.save();
  }

  flush(): Promise<void> {
    return this.store.flush();
  }

  file(id: string): StoredFile | undefined {
    return this.data.files[id];
  }

  title(id: string): StoredTitle | undefined {
    return this.data.titles[id];
  }

  files(): StoredFile[] {
    return Object.values(this.data.files);
  }

  titles(): StoredTitle[] {
    return Object.values(this.data.titles);
  }

  filesOf(titleId: string): StoredFile[] {
    const ids = this.byTitle.get(titleId);
    if (!ids) return [];
    const out: StoredFile[] = [];
    for (const id of ids) {
      const f = this.data.files[id];
      if (f) out.push(f);
    }
    return out;
  }

  filesOfLibrary(libraryId: string): StoredFile[] {
    return this.files().filter((f) => f.libraryId === libraryId);
  }

  putFile(file: StoredFile): void {
    const previous = this.data.files[file.id];
    if (previous) this.unindex(previous);
    this.data.files[file.id] = file;
    this.index(file);
    if (previous && previous.titleId !== file.titleId && !this.byTitle.get(previous.titleId)?.size) {
      this.deleteTitle(previous.titleId);
    }
  }

  /** Remove a file; its title is removed too when it has no files left. Returns the removed title id, if any. */
  deleteFile(id: string): string | null {
    const file = this.data.files[id];
    if (!file) return null;
    this.unindex(file);
    delete this.data.files[id];
    if (!this.byTitle.get(file.titleId)?.size) {
      this.deleteTitle(file.titleId);
      return file.titleId;
    }
    return null;
  }

  putTitle(title: StoredTitle): void {
    this.data.titles[title.id] = title;
  }

  deleteTitle(id: string): void {
    delete this.data.titles[id];
    this.byTitle.delete(id);
    for (const [key, titleId] of Object.entries(this.data.groups)) {
      if (titleId === id) delete this.data.groups[key];
    }
  }

  /** Find or create the title for a grouping key. */
  titleFor(kind: TitleKind, name: string, year: number | null): StoredTitle {
    const key = groupKey(kind, name, year);
    const existingId = this.data.groups[key];
    const existing = existingId ? this.data.titles[existingId] : undefined;
    if (existing) return existing;

    // A show folder without a year joins an existing show of the same name that has one.
    if (kind === 'show' && !year) {
      const prefix = `${key}:`;
      const matches = Object.entries(this.data.groups).filter(([k]) => k.startsWith(prefix));
      const only = matches.length === 1 ? this.data.titles[matches[0]![1]] : undefined;
      if (only) {
        this.data.groups[key] = only.id;
        return only;
      }
    }

    let id = hashId(key);
    while (this.data.titles[id]) id = hashId(`${key}:${Math.random()}`);
    const title = newTitle(kind, name, year, id);
    this.data.titles[id] = title;
    this.data.groups[key] = id;
    return title;
  }

  /** Move every file and grouping key of `fromId` onto `intoId`, then delete `fromId`. */
  merge(fromId: string, intoId: string): void {
    if (fromId === intoId) return;
    for (const file of this.filesOf(fromId)) {
      this.unindex(file);
      file.titleId = intoId;
      this.index(file);
    }
    for (const [key, titleId] of Object.entries(this.data.groups)) {
      if (titleId === fromId) this.data.groups[key] = intoId;
    }
    const from = this.data.titles[fromId];
    const into = this.data.titles[intoId];
    if (from && into) into.addedAt = Math.min(into.addedAt, from.addedAt);
    delete this.data.titles[fromId];
    this.byTitle.delete(fromId);
  }
}
