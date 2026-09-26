// Title matching plus the small text helpers shared by the metadata providers.

// ---------------------------------------------------------------------------
// Provider text helpers (every value coming from an API may be missing or null)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (entity, code: string) => {
    if (code.startsWith('#')) {
      const hex = code[1] === 'x' || code[1] === 'X';
      const point = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return NAMED_ENTITIES[code] ?? entity;
  });
}

/** Plain text from an HTML-ish overview (TVmaze summaries are HTML): tags stripped, entities decoded. */
export function cleanText(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:br|p|div|li|ul|ol|h[1-6]|blockquote)\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

/** Year of a "YYYY", "YYYY-MM-DD", ISO timestamp or "2008–2013" range. */
export function yearFromDate(value: string | null | undefined): number | null {
  const match = typeof value === 'string' ? /^\s*(\d{4})/.exec(value) : null;
  const year = match ? Number(match[1]) : NaN;
  return year >= 1800 && year <= 2200 ? year : null;
}

/** "YYYY-MM-DD" from a date or ISO timestamp; null for anything else ("", "N/A"...). */
export function dateOnly(value: string | null | undefined): string | null {
  const match = typeof value === 'string' ? /^\s*(\d{4}-\d{2}-\d{2})/.exec(value) : null;
  return match ? match[1] : null;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'vs', 'via', 'with']);

/** "saving the world" -> "Saving the World", "artificial intelligence (a.i.)" -> "Artificial Intelligence (A.I.)". */
export function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      if (i > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      return word.replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
    })
    .join(' ');
}

/** Trimmed, non-empty, case-insensitively unique strings in their original order. */
export function uniq(values: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : '';
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** The value when it really is an array, else []. */
export function list<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/** Finite positive numbers only (APIs use 0 for "unknown" runtimes and ratings). */
export function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function defaultSeasonName(season: number): string {
  return season === 0 ? 'Specials' : `Season ${season}`;
}

// ---------------------------------------------------------------------------
// Title matching
// ---------------------------------------------------------------------------

/** Candidates scoring below this are never picked automatically. */
export const MATCH_THRESHOLD = 0.75;

const EXACT_BONUS = 0.05;
const YEAR_EXACT_BONUS = 0.2;
const YEAR_CLOSE_BONUS = 0.05;
const YEAR_MISMATCH_PENALTY = -0.4;
/** Differing numbers ("Toy Story 2" vs "Toy Story 3") mean another entry of a franchise. */
const NUMBER_MISMATCH_CAP = 0.6;
/** Keeps fuzzy scores below those of (compact-)equal titles. */
const FUZZY_CAP = 0.96;

const ROMAN_NUMERALS: Record<string, string> = {
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};

/**
 * Canonical form for comparing titles: lowercase, no diacritics, "&" -> "and", apostrophes dropped,
 * other punctuation -> space, roman numerals II-X -> digits, no leading "the" ("Matrix, The" too)
 * and no disambiguating year suffix ("Doctor Who (2005)").
 */
export function normalizeTitle(title: string): string {
  let s = title.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().trim();
  s = s.replace(/\s*[([]\s*(?:18|19|20)\d{2}\s*[)\]]$/, '');
  s = s.replace(/,\s*the$/, '');
  s = s.replace(/&/g, ' and ').replace(/['’‘`´]/g, '');
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  s = s
    .split(' ')
    .map((word) => ROMAN_NUMERALS[word] ?? word)
    .join(' ');
  return s.startsWith('the ') ? s.slice(4) : s;
}

function bigramDice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      counts.set(gram, count - 1);
      shared++;
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}

function tokenDice(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}

/**
 * One title is the other followed by extra words ("Star Wars" / "Star Wars Episode IV A New Hope",
 * "Dr. Strangelove" / "Dr. Strangelove or: How I Learned..."). Deliberately scores below the
 * threshold so that a matching year is needed to accept such a candidate.
 */
function prefixContainment(a: readonly string[], b: readonly string[], lengthRatio: number, shortLength: number): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length === long.length || shortLength < 3) return 0;
  return short.every((token, i) => token === long[i]) ? 0.52 + 0.3 * lengthRatio : 0;
}

const numbersOf = (tokens: readonly string[]): string =>
  tokens
    .filter((t) => /^\d+$/.test(t))
    .map((t) => String(Number(t)))
    .sort()
    .join(' ');

/** Title similarity in [0, 1]; 1 means equal once normalised. */
export function similarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ca = na.replace(/ /g, '');
  const cb = nb.replace(/ /g, '');
  if (ca === cb) return 0.97; // "Spider-Man" vs "Spiderman"

  const ta = na.split(' ');
  const tb = nb.split(' ');
  const shortLength = Math.min(ca.length, cb.length);
  const ratio = shortLength / Math.max(ca.length, cb.length);
  let score = 0.6 * bigramDice(ca, cb) + 0.4 * tokenDice(ta, tb);
  if (ratio < 0.5) score *= 0.5 + ratio;
  score = Math.max(score, prefixContainment(ta, tb, ratio, shortLength));
  if (numbersOf(ta) !== numbersOf(tb)) score = Math.min(score, NUMBER_MISMATCH_CAP);
  return Math.min(score, FUZZY_CAP);
}

export interface MatchQuery {
  name: string;
  year?: number | null;
}

export interface Matchable {
  name: string;
  originalName?: string | null;
  year: number | null;
}

/**
 * Similarity of the best of name/originalName, adjusted by year (+0.2 same, +0.05 off by one,
 * -0.4 otherwise, when both are known) and +0.05 for an exact normalised match. Range ~[-0.4, 1.25].
 */
export function scoreCandidate(query: MatchQuery, candidate: Matchable): number {
  const wanted = normalizeTitle(query.name);
  let score = 0;
  let exact = false;
  for (const name of [candidate.name, candidate.originalName]) {
    if (!name) continue;
    score = Math.max(score, similarity(query.name, name));
    exact ||= wanted !== '' && normalizeTitle(name) === wanted;
  }
  if (exact) score += EXACT_BONUS;
  if (query.year && candidate.year) {
    const diff = Math.abs(query.year - candidate.year);
    score += diff === 0 ? YEAR_EXACT_BONUS : diff === 1 ? YEAR_CLOSE_BONUS : YEAR_MISMATCH_PENALTY;
  }
  return score;
}

/**
 * Highest-scoring candidate at or above `threshold`, or null. Equal scores keep the provider's
 * relevance order (the earlier candidate wins).
 */
export function pickBest<T extends Matchable>(
  query: MatchQuery,
  candidates: readonly T[],
  threshold = MATCH_THRESHOLD,
): (T & { score: number }) | null {
  let best: (T & { score: number }) | null = null;
  for (const candidate of candidates) {
    const score = scoreCandidate(query, candidate);
    if (score >= threshold && (!best || score > best.score)) best = { ...candidate, score };
  }
  return best;
}
