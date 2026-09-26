/**
 * Turns library-relative paths into structured names: movie vs. episode, title, year, season,
 * episode, external ids, edition, resolution and stacking part.
 *
 * Follows the Plex / Jellyfin / Sonarr / Radarr naming conventions and copes with scene release
 * names, anime fansub names and messy real-world folder layouts. Everything in this module is
 * pure and synchronous, and `parseMediaPath` never throws.
 */
import type { LibraryKind } from '../shared/types.js';
import type { ParsedName } from '../types.js';

// ---------------------------------------------------------------------------
// File / directory classification
// ---------------------------------------------------------------------------

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp4', 'm4v', 'mkv', 'avi', 'mov', 'wmv', 'webm', 'mpg', 'mpeg', 'm2ts', 'mts', 'ts', 'flv', 'ogv', '3gp',
  'divx', 'vob', 'asf',
]);

/** Lowercase directory names that never contain library content. "Specials" is season 0, so it is absent. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  '@eadir', '@recycle', '@recently-snapshot', '@tmp', '@sharebin', '#recycle', '#snapshot', '$recycle.bin',
  'recycler', 'system volume information', 'lost+found', 'plex versions',
  // Plex-style local extras folders.
  'extras', 'featurettes', 'behind the scenes', 'behindthescenes', 'deleted scenes', 'deletedscenes',
  'interviews', 'scenes', 'shorts', 'trailers', 'sample', 'samples', 'other',
]);

const SAMPLE_MAX_BYTES = 500 * 1024 * 1024;
/** Plex local-extra suffixes: "Inception (2010)-trailer.mp4". */
const EXTRA_SUFFIX_RE =
  /\s*-(?:trailer|sample|featurette|behindthescenes|deleted|deletedscene|interview|scene|short|other|teaser|clip)$/i;

function pathSegments(p: string): string[] {
  return p
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.');
}

function baseName(p: string): string {
  const segs = pathSegments(p);
  return segs.length > 0 ? segs[segs.length - 1] : '';
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Drops the extension: a known video extension, or any short suffix starting with a letter. */
function stripExtension(name: string): string {
  const m = /\.([a-z0-9]{2,4})$/i.exec(name);
  if (!m) return name;
  if (m.index === 0) return VIDEO_EXTENSIONS.has(m[1].toLowerCase()) ? '' : name;
  const ext = m[1].toLowerCase();
  return VIDEO_EXTENSIONS.has(ext) || /^[a-z]/.test(ext) ? name.slice(0, m.index) : name;
}

export function isVideoFile(fileName: string): boolean {
  const name = baseName(fileName);
  if (name.startsWith('._')) return false; // macOS resource forks
  return VIDEO_EXTENSIONS.has(extensionOf(name));
}

export function shouldSkipDirectory(dirName: string): boolean {
  const name = dirName.trim().toLowerCase();
  if (name === '') return false;
  if (name.startsWith('.')) return true; // hidden: .Trash-1000, .@__thumb, .AppleDouble, .git ...
  return SKIPPED_DIRECTORIES.has(name);
}

export function isExtraOrSample(fileName: string, sizeBytes: number): boolean {
  const stem = stripExtension(baseName(fileName)).trim();
  if (EXTRA_SUFFIX_RE.test(stem) || /[._]trailer$/i.test(stem) || /^trailer$/i.test(stem)) return true;
  // "sample" as a whole word, but only for small files: a 2 GB movie called "The Sample" is real.
  return sizeBytes < SAMPLE_MAX_BYTES && stem.toLowerCase().split(/[^a-z0-9]+/).includes('sample');
}

// ---------------------------------------------------------------------------
// Title keys
// ---------------------------------------------------------------------------

const FOLDED_LETTERS: Record<string, string> = { æ: 'ae', œ: 'oe', ø: 'o', ß: 'ss', đ: 'd', ł: 'l', þ: 'th', ð: 'd', ı: 'i' };

/** Grouping key: "Marvel's Agents of S.H.I.E.L.D." and "Marvels Agents of SHIELD" both give "marvels agents of shield". */
export function titleKey(title: string): string {
  return (
    title
      // Dotted acronyms first ("S.H.I.E.L.D." -> "SHIELD"), before dots become spaces.
      .replace(/(?<![\p{L}\p{N}])(\p{L})\.(?=\p{L}(?![\p{L}\p{N}]))/gu, '$1')
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[æœøßđłþðı]/g, (c) => FOLDED_LETTERS[c] ?? c)
      .replace(/&/g, ' and ')
      .replace(/['’‘`´ʼ]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  );
}

export function sortName(title: string): string {
  return title.trim().toLowerCase().replace(/^(?:the|a|an)\s+/, '');
}

// ---------------------------------------------------------------------------
// Release tags (quality, source, codec, audio, flags)
// ---------------------------------------------------------------------------

/** Unambiguous scene tags: the title ends where the first one starts. */
const STRONG_TAGS = [
  '(?:240|360|480|540|576|720|1080|1440|2160|4320)[pi]', '[48]k', 'uhd', '\\d{3,4}x\\d{3,4}',
  'blu-?ray', 'bd-?rip', 'br-?rip', 'bd-?remux', 'bd(?:25|50|66|100)', 'bdmv',
  'web-?dl', 'web-?rip', 'web-?hd', 'hd-?tv', 'pdtv', 'sdtv', 'dsr', 'hd-?rip', 'dvd-?rip', 'dvd-?scr', 'dvd-?r',
  'dvd[59]', 'hd-?cam', 'hd-?ts', 'telesync', 'telecine', 'vhs-?rip', 'tv-?rip', 'sat-?rip', 'ppv',
  'x\\.?26[45]', 'h\\.?26[45]', 'hevc', 'xvid', 'divx', 'av1', 'vp9', 'mpeg-?2',
  'aac(?:\\d(?:\\.\\d)?)?', 'e?-?ac-?3', 'dd\\+?p?\\d\\.\\d', 'ddp', 'dd\\+', 'true-?hd', 'dts(?:-?(?:hd|ma|x|es|hra))*',
  'flac', 'mp3', 'l?pcm',
  '10-?bits?', '8-?bits?', 'hi10p?', 'hdr10(?:\\+|plus)?', 'dovi', 'dolby[ ._-]?vision', 'remux',
  'amzn', 'dsnp', 'hmax', 'atvp', 'pcok', 'pmtp', 'crav',
  'readnfo', 'nfofix', 'subfix', 'dirfix', 'rerip',
];

/** Tags that are also ordinary words ("Charlotte's Web"): only cut when context says they are tags. */
const WEAK_TAGS = [
  'web', 'bd', 'dvd', 'hdr', 'sdr', 'hlg', 'dv', 'avc', 'cam', 'ts', 'tc', 'scr', 'screener', 'r5', 'atmos', 'opus',
  'dd', 'proper', 'repack', 'real', 'internal', 'limited', 'dubbed', 'subbed', 'multi', 'multisubs',
  'dual[ ._-]?audio', 'dual', 'complete', 'uncensored', 'uncut', 'extended', 'unrated', 'remastered',
  'nf', 'hulu', 'stan', 'hc', 'hardsubs?', 'softsubs?', '[257]\\.[01]', '[268]ch',
  'truefrench', 'vostfr', 'vost', 'french', 'german', 'ita', 'eng', 'latino', 'castellano', 'hindi',
];

const STRONG_TAG_RE = new RegExp(`(?:${STRONG_TAGS.join('|')})(?![\\p{L}\\p{N}])`, 'iuy');
const WEAK_TAG_RE = new RegExp(`(?:${WEAK_TAGS.join('|')})(?![\\p{L}\\p{N}])`, 'iuy');
const SEPARATOR_CHARS = /[\s._\-–—,+~]/;
const TOKEN_BOUNDARY = /[\s._\-–—,+~[\](){}]/;

function matchTagAt(s: string, i: number): { strong: boolean; end: number } | null {
  STRONG_TAG_RE.lastIndex = i;
  let m = STRONG_TAG_RE.exec(s);
  if (m) return { strong: true, end: i + m[0].length };
  WEAK_TAG_RE.lastIndex = i;
  m = WEAK_TAG_RE.exec(s);
  return m ? { strong: false, end: i + m[0].length } : null;
}

function skipSeparators(s: string, i: number): number {
  while (i < s.length && SEPARATOR_CHARS.test(s[i])) i++;
  return i;
}

function isTokenStart(s: string, i: number): boolean {
  return /[\p{L}\p{N}]/u.test(s[i]) && (i === 0 || TOKEN_BOUNDARY.test(s[i - 1]));
}

const hasWordChar = (s: string): boolean => /[\p{L}\p{N}]/u.test(s);

/**
 * Index where release junk starts, or -1. Strong tags cut anywhere after some title text; weak
 * tags only when written like scene tags (upper case, or all-lowercase names) and followed by
 * another tag, or when upper case inside a mixed-case name ("Movie.Name.PROPER").
 */
function findTagCut(s: string, allowAtStart = false): number {
  const hasLower = /\p{Ll}/u.test(s);
  const hasUpper = /\p{Lu}/u.test(s);
  for (let i = 0; i < s.length; i++) {
    if (!isTokenStart(s, i)) continue;
    const tag = matchTagAt(s, i);
    if (!tag) continue;
    if (!allowAtStart && !hasWordChar(s.slice(0, i))) continue;
    if (tag.strong) return i;
    const word = s.slice(i, tag.end);
    const letters = word.replace(/[^\p{L}]/gu, '');
    const upper = letters.length >= 2 && letters === letters.toUpperCase();
    const caseOk = letters.length === 0 || upper || !hasUpper;
    if (!caseOk) continue;
    const next = skipSeparators(s, tag.end);
    if (next < s.length && isTokenStart(s, next) && matchTagAt(s, next)) return i;
    if (upper && hasLower) return i;
    if (allowAtStart && i === 0 && next >= s.length) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Years
// ---------------------------------------------------------------------------

const YEAR_RE = /(?<=^|[\s._\-[\](){},])((?:19|20)\d{2})(?=$|[\s._\-[\](){},])/g;

interface YearHit {
  year: number;
  index: number;
}

function yearCandidates(s: string): YearHit[] {
  const max = new Date().getFullYear() + 1;
  const out: YearHit[] = [];
  for (const m of s.matchAll(YEAR_RE)) {
    const year = Number(m[1]);
    if (year >= 1880 && year <= max) out.push({ year, index: m.index ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// External ids: {imdb-tt0133093} [imdbid-tt0133093] [tt0133093] tt0133093 {tmdb-603} [tvdbid-81189]
// ---------------------------------------------------------------------------

interface Ids {
  imdbId: string | null;
  tmdbId: number | null;
  tvdbId: number | null;
}

const ID_PATTERNS: { re: RegExp; key: keyof Ids }[] = [
  { re: /[[{(]\s*imdb(?:id)?\s*[-=:_ ]\s*(tt\d{7,8})\s*[\]})]/gi, key: 'imdbId' },
  { re: /[[{(]\s*tmdb(?:id)?\s*[-=:_ ]\s*(\d{1,9})\s*[\]})]/gi, key: 'tmdbId' },
  { re: /[[{(]\s*tvdb(?:id)?\s*[-=:_ ]\s*(\d{1,9})\s*[\]})]/gi, key: 'tvdbId' },
  { re: /[[{(]\s*(tt\d{7,8})\s*[\]})]/gi, key: 'imdbId' },
  { re: /(?<![\p{L}\p{N}])imdb(?:id)?[-=:_]?(tt\d{7,8})(?![\p{L}\p{N}])/giu, key: 'imdbId' },
  { re: /(?<![\p{L}\p{N}])tmdb(?:id)?[-=:_](\d{1,9})(?![\p{L}\p{N}])/giu, key: 'tmdbId' },
  { re: /(?<![\p{L}\p{N}])tvdb(?:id)?[-=:_](\d{1,9})(?![\p{L}\p{N}])/giu, key: 'tvdbId' },
  { re: /(?<![\p{L}\p{N}])(tt\d{7,8})(?![\p{L}\p{N}])/giu, key: 'imdbId' },
];

/** Removes id tokens from `s`, recording the first value seen for each id kind into `ids`. */
function collectIds(s: string, ids: Ids, replacement = ' '): string {
  let out = s;
  for (const { re, key } of ID_PATTERNS) {
    out = out.replace(re, (_whole: string, id: string) => {
      if (ids[key] === null) {
        if (key === 'imdbId') ids.imdbId = id.toLowerCase();
        else ids[key] = Number(id);
      }
      return replacement;
    });
  }
  return out;
}

const stripIds = (s: string, replacement = ' '): string =>
  collectIds(s, { imdbId: null, tmdbId: null, tvdbId: null }, replacement);

/** Release group glued to a closing bracket, as Sonarr / Radarr append it: "[h264]-GROUP". */
const BRACKET_GROUP_SUFFIX_RE = /([\])])-[\p{L}\p{N}]+$/u;

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------

const EDITION_TAG_RE = /[{[]\s*edition\s*[-=:]\s*([^}\]]+?)\s*[}\]]/gi;

const wordRe = (src: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, 'giu');

/** Multi-word phrases are distinctive; single words must also be followed by release junk. */
const EDITION_PHRASES = wordRe(
  [
    "director[’']?s?[ ._-]*cut",
    'final[ ._-]+cut',
    "(?:ultimate|special|collector[’']?s|deluxe|definitive|(?:\\d{1,3}(?:st|nd|rd|th)[ ._-]+)?anniversary)[ ._-]+(?:edition|cut)",
    '(?:extended|unrated|theatrical|uncut|imax)[ ._-]+(?:edition|cut|version|release|enhanced)',
    'criterion[ ._-]+(?:collection|edition)',
    'open[ ._-]+matte',
  ].join('|'),
);
const EDITION_WORDS_SRC = 'extended|unrated|theatrical|remastered|uncut|imax|criterion';
const EDITION_WORDS = wordRe(EDITION_WORDS_SRC);
const EDITION_WORD_AT_START = new RegExp(`^(?:${EDITION_WORDS_SRC}|director|final|ultimate|special)(?![\\p{L}\\p{N}])`, 'iu');

function editionName(raw: string): string {
  return raw
    .split(/[ ._-]+/)
    .filter(Boolean)
    .map((w) => {
      const lw = w.toLowerCase().replace(/[’']/g, '');
      if (lw === 'imax') return 'IMAX';
      if (lw === 'director' || lw === 'directors') return "Director's";
      if (lw === 'collectors') return "Collector's";
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(' ');
}

function isEditionContextValid(s: string, start: number, end: number, phrase: boolean, allowAtStart: boolean): boolean {
  const before = s.slice(0, start);
  const bracketed = /[([{]\s*$/.test(before);
  if (!allowAtStart && !bracketed) {
    // Needs real title text before it: "The Final Cut (2004)" is a title, not an edition.
    const words = before
      .replace(/[[({][^\])}]*[\])}]/g, ' ')
      .split(/[^\p{L}\p{N}’']+/u)
      .filter(Boolean);
    if (words.length === 0 || words.every((w) => /^(?:the|a|an)$/i.test(w))) return false;
  }
  if (phrase || bracketed) return true;
  const j = skipSeparators(s, end);
  if (j >= s.length || /[[({]/.test(s[j])) return true;
  const rest = s.slice(j);
  return /^(?:19|20)\d{2}(?![\p{L}\p{N}])/u.test(rest) || matchTagAt(s, j) !== null || EDITION_WORD_AT_START.test(rest);
}

/** Finds and removes edition phrases; returns the remaining text and the edition names in order. */
function extractEditions(
  s: string,
  opts: { allowAtStart?: boolean; wordsOnly?: boolean } = {},
): { text: string; editions: string[] } {
  const hits: { start: number; end: number; phrase: boolean }[] = [];
  const sources = opts.wordsOnly ? [EDITION_WORDS] : [EDITION_PHRASES, EDITION_WORDS];
  for (const re of sources) {
    for (const m of s.matchAll(re)) {
      const start = m.index ?? 0;
      hits.push({ start, end: start + m[0].length, phrase: re === EDITION_PHRASES });
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: { start: number; end: number }[] = [];
  for (const h of hits) {
    if (accepted.some((a) => h.start < a.end && h.end > a.start)) continue;
    if (isEditionContextValid(s, h.start, h.end, h.phrase, opts.allowAtStart ?? false)) accepted.push(h);
  }
  if (accepted.length === 0) return { text: s, editions: [] };
  const editions: string[] = [];
  let text = '';
  let last = 0;
  for (const a of accepted) {
    const name = editionName(s.slice(a.start, a.end));
    if (!editions.includes(name)) editions.push(name);
    text += `${s.slice(last, a.start)} `;
    last = a.end;
  }
  return { text: text + s.slice(last), editions };
}

// ---------------------------------------------------------------------------
// Stacked parts: cd1, disc 2, part1, pt.2
// ---------------------------------------------------------------------------

const PART_RE = /(?<![\p{L}\p{N}])(cd|dis[ck]|part|pt)[ ._-]?(\d{1,2})(?![\p{L}\p{N}])/giu;

/** Is `rest` only release junk (separators, bracket groups, tags) with no year in it? */
function isJunkTail(rest: string): boolean {
  if (yearCandidates(rest).length > 0) return false;
  const t = rest.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ');
  const j = skipSeparators(t, 0);
  return j >= t.length || (isTokenStart(t, j) && matchTagAt(t, j) !== null);
}

/**
 * cd/disc/disk count anywhere after the title; "part"/"pt" only after the year or at the very end
 * so that "Harry Potter and the Deathly Hallows Part 1 (2010)" keeps its title.
 */
function extractPart(s: string, allowPartWord: boolean): { text: string; part: number | null } {
  for (const m of s.matchAll(PART_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const n = Number(m[2]);
    if (n < 1 || !hasWordChar(s.slice(0, start).replace(/\[[^\]]*\]/g, ''))) continue;
    const isDisc = !/^p/i.test(m[1]);
    if (!isDisc) {
      if (!allowPartWord) continue;
      const yearBefore = yearCandidates(s.slice(0, start)).some((y) => hasWordChar(s.slice(0, y.index)));
      if (!yearBefore && !isJunkTail(s.slice(end))) continue;
    }
    return { text: `${s.slice(0, start)} ${s.slice(end)}`, part: n };
  }
  return { text: s, part: null };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function detectResolution(s: string): string | null {
  const p = /(?<![\p{L}\p{N}])(240|360|480|540|576|720|1080|1440|2160|4320)([pi])(?![\p{L}\p{N}])/iu.exec(s);
  if (p) {
    if (p[1] === '2160' || p[1] === '1080' || p[1] === '720') return `${p[1]}p`;
    return `${p[1]}${p[2].toLowerCase()}`;
  }
  if (/(?<![\p{L}\p{N}])(?:4k|uhd)(?![\p{L}\p{N}])/iu.test(s)) return '2160p';
  const dims = /(?<![\p{L}\p{N}])\d{3,4}x(\d{3,4})(?![\p{L}\p{N}])/iu.exec(s);
  if (dims) {
    const h = Number(dims[1]);
    if (h >= 1800) return '2160p';
    if (h >= 1000) return '1080p';
    if (h >= 700) return '720p';
    return `${h}p`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

/** Disambiguation suffixes kept in titles: "The Office (US)". */
const COUNTRY_CODES: ReadonlySet<string> = new Set(['US', 'UK', 'AU', 'NZ', 'CA', 'IE']);

/** Removes [..] and {..} groups, and (..) groups except country codes and a leading "(500) Days of Summer". */
function stripBracketGroups(s: string): string {
  const out = s
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\[[^[\]]*\]/g, ' ')
    .replace(/\(([^()]*)\)/g, (whole: string, inner: string, offset: number, str: string) => {
      const t = inner.trim();
      if (/^[a-z]{2}$/i.test(t) && COUNTRY_CODES.has(t.toUpperCase())) return ` (${t.toUpperCase()}) `;
      const leading = str.slice(0, offset).trim() === '' && hasWordChar(str.slice(offset + whole.length));
      return leading && hasWordChar(t) ? whole : ' ';
    });
  return dropUnbalanced(out.replace(/[[\]{}]/g, ' '));
}

/** Blanks out bracket groups while keeping string indexes stable. */
const maskBrackets = (s: string): string =>
  s.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, (m) => ' '.repeat(m.length));

/** Scene-style names use dots/underscores instead of spaces (ignoring bracket groups). */
const isSceneStyle = (s: string): boolean =>
  !/\s/.test(s.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, '').trim());

function dropUnbalanced(s: string): string {
  const open: number[] = [];
  const drop = new Set<number>();
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') open.push(i);
    else if (s[i] === ')') {
      if (open.length > 0) open.pop();
      else drop.add(i);
    }
  }
  for (const i of open) drop.add(i);
  if (drop.size === 0) return s;
  return [...s].map((c, i) => (drop.has(i) ? ' ' : c)).join('');
}

/** Two or more single letters each followed by a dot: "S.H.I.E.L.D", "E.T.", "L.A.". */
const ACRONYM_RE = /(?<![\p{L}\p{N}])(?:\p{L}\.){2,}(?:\p{L}(?![\p{L}\p{N}]))?/gu;
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'vol', 'sgt', 'lt', 'capt', 'prof',
]);

/**
 * Dots and underscores to spaces. Dotted acronyms and abbreviations ("Mr.", "Vol.") keep their
 * dot. In names that already use spaces, a dot followed by a space is punctuation and stays.
 */
function convertSeparators(s: string, sceneStyle: boolean): string {
  // Dots inside acronyms stay glued; the acronym's last dot gets a space if a word follows ("L.A. Confidential").
  const keep = new Set<number>();
  const lastDot = new Set<number>();
  for (const m of s.matchAll(ACRONYM_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    for (let i = start; i < end; i++) if (s[i] === '.') keep.add(i);
    if (s[end - 1] === '.') lastDot.add(end - 1);
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '_') {
      out += ' ';
      continue;
    }
    if (c !== '.') {
      out += c;
      continue;
    }
    const next = s[i + 1] ?? '';
    const prev = s[i - 1] ?? '';
    const nextIsWord = /[\p{L}\p{N}]/u.test(next);
    if (keep.has(i)) {
      out += lastDot.has(i) && nextIsWord ? '. ' : '.';
      continue;
    }
    let wordStart = i;
    while (wordStart > 0 && /\p{L}/u.test(s[wordStart - 1])) wordStart--;
    const prevWord =
      wordStart < i && (wordStart === 0 || !/\p{N}/u.test(s[wordStart - 1])) ? s.slice(wordStart, i).toLowerCase() : '';
    if (ABBREVIATIONS.has(prevWord) && (next === '' || nextIsWord || next === ' ')) {
      out += nextIsWord ? '. ' : '.';
      continue;
    }
    if (!sceneStyle) {
      if (next === '' || next === ' ' || next === '.' || prev === '.') {
        out += '.';
        continue;
      }
      if (/\d/.test(prev) && /\d/.test(next)) {
        out += '.';
        continue;
      }
    }
    out += ' ';
  }
  return out;
}

const EDGE_JUNK = '\\s\\-–—_,:;~+|/\\\\';
const LEADING_JUNK_RE = new RegExp(`^[${EDGE_JUNK}.]+`);
const TRAILING_JUNK_RE = new RegExp(`[${EDGE_JUNK}]+$`);

function trimSeparators(s: string): string {
  let t = s.replace(/\s+/g, ' ').replace(LEADING_JUNK_RE, '').replace(TRAILING_JUNK_RE, '');
  // A trailing dot survives only on acronyms ("S.W.A.T.") and abbreviations ("Jr.").
  while (t.endsWith('.')) {
    const acronym = /(?<![\p{L}\p{N}])(?:\p{L}\.){2,}$/u.test(t);
    const abbr = /(?<![\p{L}\p{N}])(\p{L}+)\.$/u.exec(t);
    if (acronym || (abbr && ABBREVIATIONS.has(abbr[1].toLowerCase()))) break;
    t = t.slice(0, -1).replace(TRAILING_JUNK_RE, '');
  }
  return t.trim();
}

const SMALL_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'of', 'in', 'on', 'at', 'to', 'by', 'as', 'vs', 'vs.', 'via',
  'from', 'with', 'into', 'onto', 'per',
]);
const ROMAN_NUMERAL_RE = /^(?:ii|iii|iv|vi|vii|viii|ix|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)$/i;

function casedWord(word: string, first: boolean, last: boolean): string {
  const lw = word.toLowerCase();
  if (/^(?:\p{L}\.){2,}\p{L}?\.?$/u.test(word)) return word.toUpperCase(); // s.h.i.e.l.d.
  const core = lw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (ROMAN_NUMERAL_RE.test(core)) return word.toUpperCase();
  if (/^\((?:us|uk|au|nz|ca|ie)\)$/.test(lw)) return word.toUpperCase();
  if (!first && !last && SMALL_WORDS.has(lw)) return lw;
  // Capitalise the first letter and each hyphenated part: "spider-man" -> "Spider-Man".
  return lw.replace(/(^|[-(/"“])(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase());
}

/** Title-cases names written entirely in lower or upper case ("the matrix", "THE MATRIX"). */
function fixCasing(title: string): string {
  if (title.length <= 4) return title;
  const lower = title.toLowerCase();
  const upper = title.toUpperCase();
  if (lower === upper || (title !== lower && title !== upper)) return title;
  const words = title.split(' ');
  return words.map((w, i) => casedWord(w, i === 0, i === words.length - 1)).join(' ');
}

const isUniformCase = (s: string): boolean => {
  const letters = s.replace(/[^\p{L}]/gu, '');
  return letters.length > 0 && (letters === letters.toLowerCase() || letters === letters.toUpperCase());
};

// ---------------------------------------------------------------------------
// Title analysis
// ---------------------------------------------------------------------------

interface TitleInfo {
  title: string;
  year: number | null;
  edition: string | null;
  part: number | null;
}

interface AnalyzeOptions {
  /** Dots are word separators (no spaces in the original name). Inferred when omitted. */
  sceneStyle?: boolean;
  editions?: boolean;
  /** false: no part detection; 'disc': cd/disc/disk only; true (default): also part/pt. */
  parts?: boolean | 'disc';
  fixCase?: boolean;
}

/** Cleans the text that precedes the year (or a whole name without year) into a display title. */
function cleanHead(head: string, sceneStyle: boolean, fixCase: boolean): string {
  let s = stripBracketGroups(head.trim().replace(BRACKET_GROUP_SUFFIX_RE, '$1'));
  const cut = findTagCut(s);
  if (cut >= 0) s = s.slice(0, cut);
  s = trimSeparators(convertSeparators(s, sceneStyle));
  s = trimSeparators(dropUnbalanced(s));
  return fixCase ? fixCasing(s) : s;
}

/**
 * The year is the last standalone 19xx/20xx token that has title text before it (so "2012.2009"
 * is "2012" from 2009 and "Blade Runner 2049 (2017)" keeps 2049), ignoring years that only show
 * up after release tags when an earlier one exists.
 */
function pickYear(s: string, sceneStyle: boolean): YearHit | null {
  const candidates = yearCandidates(s);
  if (candidates.length === 0) return null;
  const firstTag = findTagCut(maskBrackets(s));
  const beforeTags = firstTag >= 0 ? candidates.filter((c) => c.index < firstTag) : candidates;
  const pool = beforeTags.length > 0 ? beforeTags : candidates;
  for (let i = pool.length - 1; i >= 0; i--) {
    if (cleanHead(s.slice(0, pool[i].index), sceneStyle, false) !== '') return pool[i];
  }
  return null;
}

function analyzeTitle(raw: string, opts: AnalyzeOptions = {}): TitleInfo {
  const sceneStyle = opts.sceneStyle ?? isSceneStyle(raw);
  let s = stripIds(raw).replace(EDITION_TAG_RE, ' ');
  let edition: string | null = null;
  if (opts.editions !== false) {
    const e = extractEditions(s);
    s = e.text;
    edition = e.editions.length > 0 ? e.editions.join(' ') : null;
  }
  let part: number | null = null;
  if (opts.parts !== false) {
    const p = extractPart(s, opts.parts !== 'disc');
    s = p.text;
    part = p.part;
  }
  const yearHit = pickYear(s, sceneStyle);
  const head = yearHit ? s.slice(0, yearHit.index) : s;
  const title = cleanHead(head, sceneStyle, opts.fixCase !== false);
  return { title, year: yearHit?.year ?? null, edition, part };
}

/**
 * Cleans a raw name (file name without extension, folder name, embedded tag) into a display
 * title: drops ids, editions, years and everything after them, bracketed groups, release tags
 * and groups, turns dots/underscores into spaces and fixes all-lower/all-upper casing.
 * Returns '' when nothing usable is left.
 */
export function cleanTitle(raw: string): string {
  try {
    const s = cutSeasonMarkers(stripIds(raw).replace(SITE_PREFIX_RE, ''));
    return analyzeTitle(s, { sceneStyle: isSceneStyle(raw) }).title;
  } catch {
    return typeof raw === 'string' ? raw.trim() : '';
  }
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const g = a.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const g = b.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (a.length + b.length - 2);
}

/** Same title modulo punctuation/spacing, whole-word containment, or near-identical spelling. */
function similarTitles(a: string, b: string): boolean {
  const ka = titleKey(a);
  const kb = titleKey(b);
  if (ka === '' || kb === '') return false;
  const ca = ka.replace(/ /g, '');
  const cb = kb.replace(/ /g, '');
  if (ca === cb) return true;
  const shorter = ca.length <= cb.length ? ka : kb;
  const longer = shorter === ka ? kb : ka;
  if (shorter.replace(/ /g, '').length >= 3 && ` ${longer} `.includes(` ${shorter} `)) return true;
  return diceCoefficient(ca, cb) >= 0.8;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

const SEASON_WORD =
  '(?:season|series|staffel|saison|temporada|stagione|seizoen|s[æa]e?son|s[äa]song|sesong|kausi|sezona?)';
const PURE_SEASON_RE = new RegExp(`^${SEASON_WORD}[ ._-]*(\\d{1,4})(?![\\p{L}\\p{N}])`, 'iu');
const PURE_S_RE = /^s(\d{1,4})(?![\p{L}\p{N}])/iu;
const SPECIALS_RE = /^(?:specials?|season[ ._-]*specials?)$/i;
const SEASON_MARKER_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${SEASON_WORD}[ ._-]*(\\d{1,4})|s(\\d{1,2}))(?![\\p{L}\\p{N}])`,
  'iu',
);
const MULTI_SEASON_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:s\\d{1,2}[ ._-]*-[ ._-]*s?\\d{1,2}|${SEASON_WORD}s?[ ._-]*\\d{1,2}[ ._-]*-[ ._-]*\\d{1,2})(?![\\p{L}\\p{N}])`,
  'iu',
);
const COMPLETE_RE =
  /(?<![\p{L}\p{N}])(?:the[ ._-]+)?complete(?:[ ._-]+(?:series|collection|seasons?|box[ ._-]*set))?(?![\p{L}\p{N}])/iu;
/** Web-site spam prefixes: "www.Torrenting.com - Show.S01E01". */
const SITE_PREFIX_RE = /^\s*www\.[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+\s*[-–_]*\s*/iu;
/** Structural folders that never carry the title (disc structures, stacking folders). */
const IGNORABLE_DIR_RE =
  /^(?:bdmv|stream|video_ts|audio_ts|playlist|clipinf|backup|certificate|(?:cd|dis[ck]|dvd|part|pt)[ ._-]?\d{1,2})$/i;
const FOLDER_PART_RE = /^(?:cd|dis[ck]|part|pt)[ ._-]?(\d{1,2})$/i;

/** Category / download folders that say nothing about the title (compared by titleKey). */
const GENERIC_NAMES: ReadonlySet<string> = new Set([
  'tv', 'tv shows', 'tvshows', 'tv series', 'television', 'shows', 'series', 'anime', 'cartoons', 'kids',
  'documentaries', 'docs', 'downloads', 'download', 'complete', 'completed', 'incoming', 'unsorted', 'new',
  'videos', 'video', 'media', 'movies', 'movie', 'films', 'film', 'library', 'content', 'torrents', 'torrent',
  'usenet', 'plex', 'jellyfin', 'emby', 'kodi', 'share', 'shared', 'public', 'data', 'nas', 'home', 'users',
  'misc', 'other', 'others', 'multimedia', 'recordings', 'recorded tv', 'dvr',
  // Generic file names (disc rips, camera files, placeholders).
  'title', 'main', 'feature', 'main feature', 'main movie', 'index', 'bdmv', 'stream', 'episode',
]);
const GENERIC_NAME_RE = /^(?:vts(?: \d+)+|(?:title )?t\d{1,3}|title \d{1,3}|\d{5,}|0\d*)$/;

function isGenericName(title: string): boolean {
  const key = titleKey(title);
  return key === '' || GENERIC_NAMES.has(key) || GENERIC_NAME_RE.test(key);
}

interface FolderInfo {
  /** Season this folder stands for ("Season 2", "S02", "Specials", "Show.S02.1080p-GRP"). */
  season: number | null;
  /** Only a season marker, no show name in it. */
  pureSeason: boolean;
  ignorable: boolean;
  part: number | null;
  /** Named after a single episode ("Show.S01E01.720p-GRP"). */
  episodeFolder: boolean;
}

function analyzeFolder(raw: string): FolderInfo {
  const name = stripIds(raw).trim();
  const partMatch = FOLDER_PART_RE.exec(name);
  const info: FolderInfo = {
    season: null,
    pureSeason: false,
    ignorable: IGNORABLE_DIR_RE.test(name),
    part: partMatch ? Number(partMatch[1]) : null,
    episodeFolder: SXE_RE.test(name),
  };
  if (SPECIALS_RE.test(name)) return { ...info, season: 0, pureSeason: true };
  const pure = PURE_SEASON_RE.exec(name) ?? PURE_S_RE.exec(name);
  if (pure) return { ...info, season: Number(pure[1]), pureSeason: true };
  if (!info.episodeFolder && !MULTI_SEASON_RE.test(name)) {
    const m = SEASON_MARKER_RE.exec(name);
    if (m && hasWordChar(maskBrackets(name.slice(0, m.index)))) info.season = Number(m[1] ?? m[2]);
  }
  return info;
}

/**
 * Cuts a name at the first season / episode marker that follows some title text:
 * "Breaking.Bad.S01.1080p" -> "Breaking.Bad.", "Show Name Complete Series" -> "Show Name ".
 * A bare "complete" only counts when it looks like a tag ("A Complete Unknown" stays).
 */
function cutSeasonMarkers(s: string): string {
  let cut = s.length;
  for (const re of [SXE_RE, MULTI_SEASON_RE, SEASON_MARKER_RE, COMPLETE_RE]) {
    const m = re.exec(s);
    if (!m || m.index >= cut || !hasWordChar(maskBrackets(s.slice(0, m.index)))) continue;
    if (re === COMPLETE_RE && !/\s/.test(m[0].trim()) && !/[._-]/.test(m[0])) {
      const rest = s.slice(m.index + m[0].length);
      const bare = m[0].replace(/^the[ ._-]+/i, '');
      if (bare !== bare.toUpperCase() && !isJunkTail(rest) && !SEASON_MARKER_RE.test(rest)) continue;
    }
    cut = m.index;
  }
  return s.slice(0, cut);
}

/** Show name from a show / season-pack / episode folder: "Breaking.Bad.S01.1080p.BluRay-ROVERS" -> Breaking Bad. */
function showFolderTitle(raw: string): TitleInfo | null {
  const s = cutSeasonMarkers(stripIds(raw).replace(EDITION_TAG_RE, ' '));
  const info = analyzeTitle(s, { sceneStyle: isSceneStyle(raw), editions: false, parts: false });
  return info.title === '' || isGenericName(info.title) ? null : info;
}

function movieFolderTitle(raw: string): TitleInfo | null {
  const info = analyzeTitle(raw, { parts: false });
  return info.title === '' || isGenericName(info.title) ? null : info;
}

interface FolderLayout {
  seasonCtx: number | null;
  /** A folder provides the season (pure season folder or season pack). */
  seasonFolder: boolean;
  /** Index (into the folder list) of the show folder candidate, or -1. */
  showDir: number;
  /** Index of a folder named after this very episode, or -1. */
  episodeDir: number;
  /** Nearest folder usable for a movie title, or -1. */
  movieDir: number;
  folderPart: number | null;
}

function skipIgnorable(folders: FolderInfo[], i: number): number {
  let j = i;
  while (j >= 0 && folders[j].ignorable) j--;
  return j;
}

function folderLayout(folders: FolderInfo[]): FolderLayout {
  let i = skipIgnorable(folders, folders.length - 1);
  const folderPart = folders.slice(i + 1).find((f) => f.part !== null)?.part ?? null;
  const movieDir = i >= 0 && !folders[i].pureSeason ? i : -1;
  let episodeDir = -1;
  if (i >= 0 && folders[i].episodeFolder) {
    episodeDir = i;
    i = skipIgnorable(folders, i - 1);
  }
  let seasonCtx: number | null = null;
  let seasonFolder = false;
  if (i >= 0 && folders[i].pureSeason) {
    seasonCtx = folders[i].season;
    seasonFolder = true;
    i = skipIgnorable(folders, i - 1);
  } else if (i >= 0 && folders[i].season !== null) {
    // Season pack folder: gives the season and is also the show folder.
    seasonCtx = folders[i].season;
    seasonFolder = true;
  }
  return { seasonCtx, seasonFolder, showDir: i, episodeDir, movieDir, folderPart };
}

// ---------------------------------------------------------------------------
// Episodes
// ---------------------------------------------------------------------------

/** S01E02, s1e2, S01.E02, S01 E02, S01_E02, S01E01E02, S01E01-E02, S01E01-02. */
const SXE_RE =
  /(?<![\p{L}\p{N}])s(\d{1,4})[ ._-]{0,3}e(\d{1,4})(?:(?:[ ._-]*e(\d{1,4}))+|-(\d{1,3})(?![\p{L}\p{N}]))?(?!\d)/iu;
/** 1x02 / 01x02 / 1x02-03, but not 1920x1080 nor "5.1x264". */
const NX_RE = /(?<![\p{L}\p{N}]|\d[.,])(\d{1,2})x(\d{2,3})(?:[x-](\d{2,3}))?(?![\p{L}\p{N}])/iu;
const EPISODE_WORD = '(?:episode|episodio|[ée]pisode|folge|aflevering|ep)';
const WORDS_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])${SEASON_WORD}[ ._-]*(\\d{1,4})[ ._,-]*${EPISODE_WORD}[ ._-]*(\\d{1,4})(?:[ ._-]*(?:-|&|and|to)[ ._-]*(?:${EPISODE_WORD}[ ._-]*)?(\\d{1,4}))?(?!\\d)`,
  'iu',
);
const DATE_RE = /(?<![\p{L}\p{N}])((?:19|20)\d{2})([ ._-])(0[1-9]|1[0-2])\2(0[1-9]|[12]\d|3[01])(?![\p{L}\p{N}])/u;
const EP_WORD_RE = new RegExp(`(?<![\\p{L}\\p{N}])${EPISODE_WORD}[ ._-]*(\\d{1,4})(?!\\d)`, 'iu');
const E_ONLY_RE = /(?<![\p{L}\p{N}])e(\d{1,4})(?![\p{L}\p{N}])/iu;
/** Anime absolute numbering: "[Group] Show - 12 [1080p]", "Show - 012 (BD 1080p)", "Show - 12v2". */
const ANIME_RE = /\s-\s+(\d{1,4})(?:v(\d{1,2}))?(?=$|\s|[[(]|-)/gu;
const ANIME_SEASON_RE = new RegExp(
  `[ ._-]+(?:s(\\d{1,2})|${SEASON_WORD}[ ._-]*(\\d{1,2})|(\\d{1,2})(?:st|nd|rd|th)[ ._-]+season)[ ._-]*$`,
  'iu',
);
/** "05 - The Title", "05. The Title", "E05 The Title", "05" (inside a season folder). */
const LEADING_RE = /^(?:(?:e|ep|episode)[ ._-]*)?(\d{1,3})(?![\p{L}\p{N}])(?:[ ._]*-[ ._]*|[ ._]+)?(.*)$/iu;

interface EpisodeHit {
  /** Season written in the file name itself. */
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
  airDate: string | null;
  /** Raw text before / after the episode token. */
  before: string;
  after: string;
}

interface EpisodeContext {
  libraryKind: LibraryKind;
  seasonCtx: number | null;
  seasonFolder: boolean;
  inFolder: boolean;
  hasShowFolder: boolean;
}

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function detectEpisode(stem: string, ctx: EpisodeContext): EpisodeHit | null {
  const hit = (m: RegExpExecArray, fields: Partial<EpisodeHit>): EpisodeHit => ({
    season: null,
    episode: null,
    episodeEnd: null,
    airDate: null,
    before: stem.slice(0, m.index),
    after: stem.slice(m.index + m[0].length),
    ...fields,
  });
  const rangeEnd = (from: number, to: string | undefined): number | null => {
    const n = to === undefined ? NaN : Number(to);
    return n > from && n - from <= 50 ? n : null;
  };
  const kind = ctx.libraryKind;

  let m = SXE_RE.exec(stem);
  if (m) {
    const episode = Number(m[2]);
    return hit(m, { season: Number(m[1]), episode, episodeEnd: rangeEnd(episode, m[3] ?? m[4]) });
  }
  // Movies libraries only trust explicit SxxEyy markers.
  if (kind === 'movies') return null;

  m = NX_RE.exec(stem);
  if (m) {
    const episode = Number(m[2]);
    return hit(m, { season: Number(m[1]), episode, episodeEnd: rangeEnd(episode, m[3]) });
  }

  m = WORDS_RE.exec(stem);
  if (m) {
    const episode = Number(m[2]);
    return hit(m, { season: Number(m[1]), episode, episodeEnd: rangeEnd(episode, m[3]) });
  }

  if (kind === 'shows' || ctx.inFolder) {
    m = DATE_RE.exec(stem);
    if (m && validDate(Number(m[1]), Number(m[3]), Number(m[4]))) {
      return hit(m, { airDate: `${m[1]}-${m[3]}-${m[4]}` });
    }
  }

  if (ctx.seasonFolder || (kind === 'shows' && ctx.hasShowFolder)) {
    const lead = LEADING_RE.exec(stem);
    if (lead) {
      let episode = Number(lead[1]);
      const s = ctx.seasonCtx;
      // Compact "105" inside "Season 1" means S01E05.
      if (s !== null && s >= 1 && s <= 9 && lead[1].length === 3 && Math.floor(episode / 100) === s && episode % 100 > 0) {
        episode %= 100;
      }
      return { season: null, episode, episodeEnd: null, airDate: null, before: '', after: lead[2] ?? '' };
    }
  }

  const anime = detectAnime(stem, kind === 'shows');
  if (anime) return anime;

  m = EP_WORD_RE.exec(stem) ?? (ctx.seasonFolder || kind === 'shows' ? E_ONLY_RE.exec(stem) : null);
  if (m) {
    const after = stem.slice(m.index + m[0].length);
    // "Star Wars Episode 4 A New Hope (1977)" in a mixed library is a movie.
    const movieLike = kind === 'mixed' && !ctx.seasonFolder && yearCandidates(after).length > 0;
    if (!movieLike) return hit(m, { episode: Number(m[1]) });
  }
  return null;
}

function detectAnime(stem: string, lenient: boolean): EpisodeHit | null {
  const text = stem.replace(/_/g, ' ');
  for (const m of text.matchAll(ANIME_RE)) {
    const index = m.index ?? 0;
    const num = m[1];
    if (/^(?:19|20)\d{2}$/.test(num)) continue;
    let before = stem.slice(0, index);
    const after = stem.slice(index + m[0].length);
    if (!hasWordChar(stripBracketGroups(before))) continue;
    // Outside dedicated show libraries, require some fansub-style evidence.
    const evidence = /^\s*\[/.test(stem) || /^\s*[[(]/.test(after) || m[2] !== undefined || num.length >= 2;
    if (!lenient && !evidence) continue;
    let season: number | null = null;
    const sm = ANIME_SEASON_RE.exec(before);
    if (sm && hasWordChar(stripBracketGroups(before.slice(0, sm.index)))) {
      season = Number(sm[1] ?? sm[2] ?? sm[3]);
      before = before.slice(0, sm.index);
    }
    return { season, episode: Number(num), episodeEnd: null, airDate: null, before, after };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Path parsing
// ---------------------------------------------------------------------------

function emptyParsed(): ParsedName {
  return {
    kind: 'movie',
    title: 'Unknown',
    year: null,
    season: null,
    episode: null,
    episodeEnd: null,
    episodeTitle: null,
    airDate: null,
    imdbId: null,
    tmdbId: null,
    tvdbId: null,
    edition: null,
    resolution: null,
    part: null,
  };
}

interface NameYear {
  title: string;
  year: number | null;
}

/** Scene abbreviations: "got" for "Game of Thrones", "tbbt" for "The Big Bang Theory". */
function isAbbreviationOf(short: string, full: string): boolean {
  const abbr = titleKey(short);
  if (!/^[a-z0-9]{2,6}$/.test(abbr)) return false;
  const words = titleKey(full).split(' ').filter(Boolean);
  if (words.length < 2) return false;
  const initials = words.map((w) => w[0]).join('');
  return abbr === initials || (['the', 'a', 'an'].includes(words[0]!) && abbr === initials.slice(1));
}

/**
 * Show name from the file (text before the episode token) vs. the show folder. The folder wins
 * when both name the same show (nicer casing, may carry the year); otherwise the file wins,
 * since the folder may just be a category ("Kids", "HD") that isn't on the generic list.
 */
function chooseShowName(fromFile: NameYear | null, fromFolder: NameYear | null): NameYear | null {
  if (!fromFile) return fromFolder;
  if (!fromFolder) return fromFile;
  if (similarTitles(fromFile.title, fromFolder.title) || isAbbreviationOf(fromFile.title, fromFolder.title)) {
    return { title: fromFolder.title, year: fromFolder.year ?? fromFile.year };
  }
  return fromFile;
}

function cleanEpisodeTitle(after: string, sceneStyle: boolean, fixCase: boolean): string | null {
  const raw = after.trim();
  if (raw === '' || /^-[\p{L}\p{N}]+$/u.test(raw)) return null; // nothing, or only "-GROUP"
  let s = stripIds(raw).replace(EDITION_TAG_RE, ' ').trim().replace(BRACKET_GROUP_SUFFIX_RE, '$1');
  s = stripBracketGroups(s).replace(LEADING_JUNK_RE, '');
  const cut = findTagCut(s, true);
  if (cut >= 0) s = s.slice(0, cut);
  s = trimSeparators(convertSeparators(s, sceneStyle));
  if (!hasWordChar(s) || /^(?:19|20)\d{2}$/.test(s)) return null;
  return fixCase ? fixCasing(s) : s;
}

function findEditionTag(names: string[]): string | null {
  for (const name of names) {
    for (const m of name.matchAll(EDITION_TAG_RE)) {
      const value = m[1].trim();
      if (value !== '') return value;
    }
  }
  return null;
}

/**
 * Parses a path relative to the library root ("Show/Season 1/Show - S01E01.mkv", "/" or "\\"
 * separators). Never throws; `title` is always non-empty ("Unknown" as a last resort).
 */
export function parseMediaPath(relPath: string, libraryKind: LibraryKind): ParsedName {
  try {
    return parsePath(relPath, libraryKind);
  } catch {
    const title = cleanTitle(stripExtension(baseName(String(relPath ?? ''))));
    return { ...emptyParsed(), title: title || 'Unknown' };
  }
}

function parsePath(relPath: string, libraryKind: LibraryKind): ParsedName {
  const dirs = pathSegments(relPath);
  const fileName = dirs.pop() ?? '';
  const nearestFirst = [...dirs].reverse();
  const rawStem = stripExtension(fileName).replace(SITE_PREFIX_RE, '');

  // Ids anywhere in the path; the file name wins over folders, nearer folders over outer ones.
  const ids = { imdbId: null, tmdbId: null, tvdbId: null } as Ids;
  const stem = collectIds(rawStem, ids).replace(EDITION_TAG_RE, ' ').replace(/\s+/g, ' ').trim();
  for (const dir of nearestFirst) collectIds(dir, ids);
  const tagEdition = findEditionTag([rawStem, ...nearestFirst]);
  const resolution = [stem, ...nearestFirst].map((s) => detectResolution(stripIds(s))).find((r) => r !== null) ?? null;
  const sceneStyle = isSceneStyle(stripIds(rawStem, '').trim());

  const folders = dirs.map(analyzeFolder);
  const layout = folderLayout(folders);
  const showFolder = layout.showDir >= 0 ? showFolderTitle(dirs[layout.showDir]) : null;
  const base: ParsedName = { ...emptyParsed(), ...ids, resolution };

  const hit = detectEpisode(stem, {
    libraryKind,
    seasonCtx: layout.seasonCtx,
    seasonFolder: layout.seasonFolder,
    inFolder: dirs.length > 0,
    hasShowFolder: showFolder !== null,
  });

  if (hit) {
    const fileShow = hit.before.trim() ? analyzeTitle(hit.before, { sceneStyle, editions: false, parts: false }) : null;
    const episodeFolderShow = layout.episodeDir >= 0 ? showFolderTitle(dirs[layout.episodeDir]) : null;
    const show = chooseShowName(
      fileShow && fileShow.title !== '' ? fileShow : null,
      showFolder ?? episodeFolderShow,
    );
    let after = hit.after;
    let edition = tagEdition;
    const editions = extractEditions(after, { allowAtStart: true, wordsOnly: true });
    if (editions.editions.length > 0) {
      after = editions.text;
      edition ??= editions.editions.join(' ');
    }
    const disc = extractPart(after, false);
    const airYear = hit.airDate ? Number(hit.airDate.slice(0, 4)) : null;
    return {
      ...base,
      kind: 'episode',
      title: show?.title || 'Unknown',
      year: show?.year ?? null,
      season: hit.season ?? layout.seasonCtx ?? airYear ?? 1,
      episode: hit.episode,
      episodeEnd: hit.episodeEnd,
      episodeTitle: cleanEpisodeTitle(disc.text, sceneStyle, isUniformCase(stem)),
      airDate: hit.airDate,
      edition,
      part: disc.part,
    };
  }

  const file = analyzeTitle(stem, { sceneStyle });
  const folder = layout.movieDir >= 0 ? movieFolderTitle(dirs[layout.movieDir]) : null;
  let title = file.title;
  let year = file.year;
  if (folder) {
    const similar = file.title !== '' && similarTitles(file.title, folder.title);
    if (file.title === '' || isGenericName(file.title)) {
      title = folder.title;
      year = folder.year ?? file.year;
    } else if (similar && folder.year !== null && (file.year === null || file.year === folder.year)) {
      // Same movie: the folder name is usually the curated one (casing, punctuation, year).
      title = folder.title;
      year = folder.year;
    }
  }
  return {
    ...base,
    kind: 'movie',
    title: title || 'Unknown',
    year,
    edition: tagEdition ?? file.edition ?? folder?.edition ?? null,
    part: file.part ?? layout.folderPart,
  };
}
