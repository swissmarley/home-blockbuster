import type { ContinueItem, ProfileState, TitleSummary } from '@shared/types';
import { isRecentlyAdded } from './format';

export type RowType = 'standard' | 'top10' | 'continue';

export interface RowDef {
  key: string;
  title: string;
  type: RowType;
  items: TitleSummary[];
  continueItems?: ContinueItem[];
}

export type BrowseFilter = 'all' | 'show' | 'movie';

const ROW_LIMIT = 40;

const GENRE_NAMES: Record<string, [all: string, movie: string, show: string]> = {
  action: ['Action & Adventure', 'Action Movies', 'Action TV'],
  'action & adventure': ['Action & Adventure', 'Action & Adventure Movies', 'Action & Adventure TV'],
  adventure: ['Adventures', 'Adventure Movies', 'Adventure TV'],
  animation: ['Animation', 'Animated Movies', 'Animated TV'],
  anime: ['Anime', 'Anime Movies', 'Anime Series'],
  comedy: ['Comedies', 'Comedy Movies', 'TV Comedies'],
  crime: ['Crime', 'Crime Movies', 'Crime TV Shows'],
  documentary: ['Documentaries', 'Documentary Films', 'Docuseries'],
  drama: ['Dramas', 'Drama Movies', 'TV Dramas'],
  family: ['Family Time', 'Family Movies', 'Family TV'],
  fantasy: ['Fantasy', 'Fantasy Movies', 'Fantasy TV'],
  history: ['History', 'Historical Movies', 'Historical TV'],
  horror: ['Horror', 'Horror Movies', 'Horror TV Shows'],
  kids: ['Kids', 'Kids Movies', 'Kids TV'],
  music: ['Music & Musicals', 'Music & Musicals', 'Music TV'],
  mystery: ['Mysteries', 'Mystery Movies', 'Mystery TV'],
  romance: ['Romance', 'Romantic Movies', 'Romantic TV Shows'],
  'science fiction': ['Sci-Fi', 'Sci-Fi Movies', 'Sci-Fi TV'],
  'sci-fi & fantasy': ['Sci-Fi & Fantasy', 'Sci-Fi & Fantasy Movies', 'Sci-Fi & Fantasy TV'],
  thriller: ['Thrillers', 'Thriller Movies', 'TV Thrillers'],
  war: ['War', 'War Movies', 'War TV'],
  'war & politics': ['War & Politics', 'War Movies', 'War & Politics TV'],
  western: ['Westerns', 'Westerns', 'Western TV'],
  reality: ['Reality TV', 'Reality', 'Reality TV'],
  'tv movie': ['TV Movies', 'TV Movies', 'TV Movies'],
};

export function genreRowTitle(genre: string, filter: BrowseFilter): string {
  const names = GENRE_NAMES[genre.toLowerCase()];
  if (!names) return genre;
  return filter === 'movie' ? names[1] : filter === 'show' ? names[2] : names[0];
}

/** Popularity-ish score used for Top 10 and "Trending": community rating weighted by popularity. */
export function trendScore(t: TitleSummary): number {
  const rating = t.rating ?? 5;
  const pop = t.popularity ?? 0;
  return rating * 2 + Math.log10(1 + pop) * 3;
}

/** Genre affinity from thumbs ratings and watch history: positive for liked genres. */
export function genreAffinity(titles: Record<string, TitleSummary>, state: ProfileState | null): Map<string, number> {
  const affinity = new Map<string, number>();
  if (!state) return affinity;
  const bump = (titleId: string, amount: number): void => {
    const t = titles[titleId];
    if (!t) return;
    for (const g of t.genres) affinity.set(g, (affinity.get(g) ?? 0) + amount);
  };
  for (const [id, rating] of Object.entries(state.ratings)) bump(id, rating === 2 ? 3 : rating === 1 ? 2 : -3);
  const watched = new Set(Object.values(state.progress).map((p) => p.titleId));
  for (const id of watched) bump(id, 1);
  return affinity;
}

/** Netflix-style "98% Match", derived from the community rating and your taste. */
export function matchPercent(t: TitleSummary, affinity?: Map<string, number>): number | null {
  if (t.rating === null || t.rating === undefined || t.rating <= 0) return null;
  let score = 52 + t.rating * 4.6;
  if (affinity && affinity.size) {
    let bonus = 0;
    for (const g of t.genres) bonus += affinity.get(g) ?? 0;
    score += Math.max(-10, Math.min(8, bonus));
  }
  return Math.max(35, Math.min(99, Math.round(score)));
}

function genreOverlap(a: TitleSummary, b: TitleSummary): number {
  let n = 0;
  for (const g of a.genres) if (b.genres.includes(g)) n += 2;
  for (const tag of a.tags) if (b.tags.includes(tag)) n += 1;
  return n;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stable per-day shuffle so "Trending" rows feel alive without jumping around on every render. */
function dailyShuffle<T extends { id: string }>(items: T[]): T[] {
  const day = new Date().toISOString().slice(0, 10);
  return [...items].sort((a, b) => hashString(a.id + day) - hashString(b.id + day));
}

export interface BuildRowsInput {
  titles: TitleSummary[];
  titleMap: Record<string, TitleSummary>;
  state: ProfileState | null;
  continueItems: ContinueItem[];
  profileName: string;
  filter: BrowseFilter;
  genre?: string | null;
}

export function buildRows(input: BuildRowsInput): RowDef[] {
  const { titleMap, state, profileName, filter } = input;
  let titles = input.titles.filter((t) => filter === 'all' || t.kind === filter);
  if (input.genre) titles = titles.filter((t) => t.genres.includes(input.genre!));
  const inScope = (t: TitleSummary | undefined): t is TitleSummary =>
    !!t && (filter === 'all' || t.kind === filter) && (!input.genre || t.genres.includes(input.genre));

  const rows: RowDef[] = [];
  const add = (row: RowDef, min = 1): void => {
    const items = row.items.slice(0, row.type === 'top10' ? 10 : ROW_LIMIT);
    if (items.length >= min) rows.push({ ...row, items });
  };

  const continueItems = input.continueItems.filter((c) => inScope(titleMap[c.titleId]));
  if (continueItems.length) {
    rows.push({
      key: 'continue',
      title: `Continue Watching for ${profileName}`,
      type: 'continue',
      items: continueItems.map((c) => titleMap[c.titleId]!),
      continueItems,
    });
  }

  if (state?.myList.length) {
    add({ key: 'mylist', title: 'My List', type: 'standard', items: state.myList.map((id) => titleMap[id]).filter(inScope) });
  }

  const byAdded = [...titles].sort((a, b) => b.addedAt - a.addedAt);
  const recent = byAdded.filter((t) => isRecentlyAdded(t, 30));
  add({ key: 'new', title: 'New on Home Blockbuster', type: 'standard', items: recent.length >= 4 ? recent : byAdded });

  const movies = titles.filter((t) => t.kind === 'movie' && (t.rating || t.popularity));
  const shows = titles.filter((t) => t.kind === 'show' && (t.rating || t.popularity));
  const top = (list: TitleSummary[]) => [...list].sort((a, b) => trendScore(b) - trendScore(a));
  if (filter !== 'show' && movies.length >= 10) {
    add({ key: 'top-movies', title: 'Top 10 Movies in Your Library Today', type: 'top10', items: top(movies) }, 10);
  }

  const rated = titles.filter((t) => t.rating || t.popularity);
  add({ key: 'trending', title: 'Trending Now', type: 'standard', items: dailyShuffle(top(rated).slice(0, 30)) }, 4);

  // "Because you watched …" from the most recent watch.
  const lastWatched = input.continueItems[0] ?? null;
  const anchor = lastWatched ? titleMap[lastWatched.titleId] : undefined;
  if (anchor) {
    const similar = titles
      .filter((t) => t.id !== anchor.id)
      .map((t) => ({ t, score: genreOverlap(anchor, t) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.t.rating ?? 0) - (a.t.rating ?? 0))
      .map((x) => x.t);
    add({ key: 'because', title: `Because You Watched ${anchor.name}`, type: 'standard', items: similar }, 3);
  }

  if (filter !== 'movie' && shows.length >= 10) {
    add({ key: 'top-shows', title: 'Top 10 TV Shows in Your Library Today', type: 'top10', items: top(shows) }, 10);
  }

  // Genre rows, most common genres first.
  const genreCounts = new Map<string, number>();
  for (const t of titles) for (const g of t.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  const genres = [...genreCounts.entries()]
    .filter(([g, n]) => n >= 2 && g !== input.genre)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([g]) => g);
  const genreRows = genres.map<RowDef>((g) => ({
    key: `genre-${g}`,
    title: genreRowTitle(g, filter),
    type: 'standard',
    items: dailyShuffle(titles.filter((t) => t.genres.includes(g))),
  }));

  const acclaimed = titles.filter((t) => (t.rating ?? 0) >= 7.5).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const watchedTitleIds = new Set(
    Object.values(state?.progress ?? {})
      .filter((p) => p.finished)
      .map((p) => p.titleId),
  );
  const watchAgain = [...watchedTitleIds].map((id) => titleMap[id]).filter(inScope);

  // Interleave genre rows with a few curated ones, like the real thing.
  const curated: RowDef[] = [
    { key: 'acclaimed', title: 'Critically Acclaimed', type: 'standard', items: acclaimed },
    { key: 'again', title: 'Watch It Again', type: 'standard', items: watchAgain },
  ];
  const decades = new Map<number, TitleSummary[]>();
  for (const t of titles) {
    if (!t.year) continue;
    const decade = Math.floor(t.year / 10) * 10;
    if (decade >= 1950 && decade <= 2000) decades.set(decade, [...(decades.get(decade) ?? []), t]);
  }
  for (const [decade, list] of [...decades.entries()].sort((a, b) => b[0] - a[0])) {
    if (list.length >= 4) {
      curated.push({ key: `decade-${decade}`, title: `${String(decade).slice(2)}s ${filter === 'show' ? 'TV' : 'Favorites'}`, type: 'standard', items: list });
    }
  }
  const mixed: RowDef[] = [];
  const maxLen = Math.max(genreRows.length, curated.length);
  for (let i = 0; i < maxLen; i++) {
    if (genreRows[i * 2]) mixed.push(genreRows[i * 2]!);
    if (genreRows[i * 2 + 1]) mixed.push(genreRows[i * 2 + 1]!);
    if (curated[i]) mixed.push(curated[i]!);
  }
  for (const row of mixed) add(row, row.key.startsWith('genre') ? 2 : 3);

  const alpha = (list: TitleSummary[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (filter === 'all') {
    add({ key: 'all-shows', title: 'TV Shows', type: 'standard', items: alpha(titles.filter((t) => t.kind === 'show')) });
    add({ key: 'all-movies', title: 'Movies', type: 'standard', items: alpha(titles.filter((t) => t.kind === 'movie')) });
  } else {
    add({ key: 'all', title: filter === 'show' ? 'All TV Shows' : 'All Movies', type: 'standard', items: alpha(titles) });
  }

  // In small libraries many rows end up identical; keep the first of each.
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (row.type === 'continue') return true;
    const signature = row.items.map((t) => t.id).sort().join(',');
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

/** Top 10 lists used for the red "TOP 10" card badge (only meaningful in a sizeable catalogue). */
export function topTenIds(titles: TitleSummary[]): Set<string> {
  const ids = new Set<string>();
  for (const kind of ['movie', 'show'] as const) {
    const list = titles.filter((t) => t.kind === kind && (t.rating || t.popularity));
    if (list.length < 25) continue;
    for (const t of [...list].sort((a, b) => trendScore(b) - trendScore(a)).slice(0, 10)) ids.add(t.id);
  }
  return ids;
}

/** Pick the billboard title: something with big artwork, favouring recent and well-rated titles. */
export function pickBillboard(titles: TitleSummary[], seed: string): TitleSummary | null {
  const withArt = titles.filter((t) => t.images.backdrop || t.images.thumb);
  const pool = withArt.length ? withArt : titles;
  if (!pool.length) return null;
  const ranked = [...pool].sort((a, b) => {
    const sa = trendScore(a) + (isRecentlyAdded(a, 21) ? 4 : 0) + (a.images.logo ? 2 : 0) + (a.images.backdrop ? 3 : 0);
    const sb = trendScore(b) + (isRecentlyAdded(b, 21) ? 4 : 0) + (b.images.logo ? 2 : 0) + (b.images.backdrop ? 3 : 0);
    return sb - sa;
  });
  const top = ranked.slice(0, Math.min(8, ranked.length));
  return top[hashString(seed) % top.length] ?? null;
}

/** Relevance search over names, people, genres and descriptions. */
export function searchTitles(titles: TitleSummary[], query: string): TitleSummary[] {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const q = norm(query);
  if (!q) return [];
  const tokens = q.split(' ');
  const scored: Array<{ t: TitleSummary; score: number }> = [];
  for (const t of titles) {
    const name = norm(t.name);
    const people = t.people.map(norm);
    const genres = [...t.genres, ...t.tags].map(norm);
    const overview = norm(t.overview);
    let score = 0;
    if (name === q) score += 100;
    else if (name.startsWith(q)) score += 60;
    else if (name.includes(q)) score += 40;
    for (const token of tokens) {
      if (name.split(' ').some((w) => w.startsWith(token))) score += 10;
      if (people.some((p) => p.split(' ').some((w) => w.startsWith(token)))) score += 8;
      if (genres.some((g) => g.includes(token))) score += 6;
      if (token.length > 2 && overview.includes(token)) score += 2;
    }
    if (people.some((p) => p === q)) score += 30;
    if (score > 0 && tokens.every((token) => name.includes(token) || people.some((p) => p.includes(token)) || genres.some((g) => g.includes(token)) || overview.includes(token))) {
      scored.push({ t, score: score + trendScore(t) / 10 });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((x) => x.t);
}
