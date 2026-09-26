/**
 * Subtitle discovery (sidecar files next to a video, text tracks embedded in it), language tag
 * normalisation, charset detection and SRT / WebVTT / ASS / SSA parsing into plain cues.
 */
import path from 'node:path';
import type { SubtitleCue } from '../shared/types.js';
import type { ProbeSubtitle, StoredSubtitle } from '../types.js';
import { hashId } from '../util/ids.js';
import { isExtraOrSample, isVideoFile } from './filenameParser.js';

export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa';

export const SUBTITLE_EXTENSIONS: ReadonlySet<string> = new Set(['srt', 'vtt', 'ass', 'ssa']);

export function subtitleFormatFromPath(p: string): SubtitleFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(p.trim());
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return SUBTITLE_EXTENSIONS.has(ext) ? (ext as SubtitleFormat) : null;
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/** ISO 639-2/B, 639-2/T (and a few 639-3) codes -> ISO 639-1 (or the 3-letter code when none exists). */
const ISO639_2: Readonly<Record<string, string>> = {
  eng: 'en', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', rus: 'ru', jpn: 'ja',
  chi: 'zh', zho: 'zh', kor: 'ko', dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no', nob: 'nb', nno: 'nn', dan: 'da',
  fin: 'fi', pol: 'pl', tur: 'tr', ara: 'ar', heb: 'he', hin: 'hi', tha: 'th', vie: 'vi', cze: 'cs', ces: 'cs',
  hun: 'hu', gre: 'el', ell: 'el', rum: 'ro', ron: 'ro', ukr: 'uk', ind: 'id', may: 'ms', msa: 'ms', hrv: 'hr',
  srp: 'sr', slv: 'sl', slo: 'sk', slk: 'sk', bul: 'bg', cat: 'ca', est: 'et', lav: 'lv', lit: 'lt', per: 'fa',
  fas: 'fa', fil: 'fil', tgl: 'tl', ice: 'is', isl: 'is', gle: 'ga', wel: 'cy', cym: 'cy', baq: 'eu', eus: 'eu',
  glg: 'gl', alb: 'sq', sqi: 'sq', mac: 'mk', mkd: 'mk', bos: 'bs', geo: 'ka', kat: 'ka', arm: 'hy', hye: 'hy',
  kaz: 'kk', mon: 'mn', khm: 'km', lao: 'lo', bur: 'my', mya: 'my', nep: 'ne', sin: 'si', swa: 'sw', afr: 'af',
  amh: 'am', mal: 'ml', kan: 'kn', mar: 'mr', guj: 'gu', pan: 'pa', ben: 'bn', tam: 'ta', tel: 'te', urd: 'ur',
  lat: 'la', epo: 'eo', ltz: 'lb', fao: 'fo', bel: 'be', aze: 'az', uzb: 'uz', tat: 'tt', kur: 'ku', pus: 'ps',
  som: 'so', hau: 'ha', yor: 'yo', ibo: 'ig', zul: 'zu', xho: 'xh', mlt: 'mt', gla: 'gd', bre: 'br', oci: 'oc',
  mao: 'mi', mri: 'mi', yue: 'yue', cmn: 'zh',
};

/** English and native language names (lowercase, accents kept and stripped) -> code. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  english: 'en', german: 'de', deutsch: 'de', french: 'fr', français: 'fr', francais: 'fr', spanish: 'es',
  español: 'es', espanol: 'es', castellano: 'es', castilian: 'es', latino: 'es-419', latam: 'es-419',
  'latin american spanish': 'es-419', italian: 'it', italiano: 'it', portuguese: 'pt', português: 'pt',
  portugues: 'pt', brazilian: 'pt-BR', 'brazilian portuguese': 'pt-BR', 'european portuguese': 'pt-PT',
  russian: 'ru', русский: 'ru', japanese: 'ja', 日本語: 'ja', chinese: 'zh', 中文: 'zh', mandarin: 'zh',
  cantonese: 'yue', 'simplified chinese': 'zh-Hans', 'traditional chinese': 'zh-Hant', korean: 'ko', 한국어: 'ko',
  dutch: 'nl', nederlands: 'nl', flemish: 'nl', swedish: 'sv', svenska: 'sv', norwegian: 'no', norsk: 'no',
  bokmål: 'nb', bokmal: 'nb', nynorsk: 'nn', danish: 'da', dansk: 'da', finnish: 'fi', suomi: 'fi', polish: 'pl',
  polski: 'pl', turkish: 'tr', türkçe: 'tr', turkce: 'tr', arabic: 'ar', العربية: 'ar', hebrew: 'he', עברית: 'he',
  greek: 'el', ελληνικά: 'el', czech: 'cs', čeština: 'cs', cestina: 'cs', hungarian: 'hu', magyar: 'hu',
  romanian: 'ro', română: 'ro', romana: 'ro', ukrainian: 'uk', українська: 'uk', indonesian: 'id',
  'bahasa indonesia': 'id', malay: 'ms', 'bahasa melayu': 'ms', croatian: 'hr', hrvatski: 'hr', serbian: 'sr',
  srpski: 'sr', slovenian: 'sl', slovene: 'sl', slovenščina: 'sl', slovenscina: 'sl', slovak: 'sk',
  slovenčina: 'sk', slovencina: 'sk', bulgarian: 'bg', български: 'bg', catalan: 'ca', català: 'ca', catala: 'ca',
  estonian: 'et', eesti: 'et', latvian: 'lv', latviešu: 'lv', latviesu: 'lv', lithuanian: 'lt', lietuvių: 'lt',
  lietuviu: 'lt', persian: 'fa', farsi: 'fa', filipino: 'fil', tagalog: 'tl', hindi: 'hi', thai: 'th',
  vietnamese: 'vi', 'tiếng việt': 'vi', bengali: 'bn', bangla: 'bn', tamil: 'ta', telugu: 'te', urdu: 'ur',
  icelandic: 'is', íslenska: 'is', irish: 'ga', welsh: 'cy', basque: 'eu', euskara: 'eu', galician: 'gl',
  galego: 'gl', albanian: 'sq', macedonian: 'mk', bosnian: 'bs', georgian: 'ka', armenian: 'hy', kazakh: 'kk',
  mongolian: 'mn', khmer: 'km', burmese: 'my', nepali: 'ne', sinhala: 'si', swahili: 'sw', afrikaans: 'af',
  amharic: 'am', malayalam: 'ml', kannada: 'kn', marathi: 'mr', gujarati: 'gu', punjabi: 'pa', latin: 'la',
  esperanto: 'eo', belarusian: 'be', azerbaijani: 'az', uzbek: 'uz', kurdish: 'ku', maltese: 'mt',
};

/** Non-standard tags seen in the wild (OpenSubtitles codes, Chinese script shorthands...). */
const SPECIAL_TAGS: Readonly<Record<string, string>> = {
  pob: 'pt-BR', pb: 'pt-BR', ptbr: 'pt-BR', 'pt-br': 'pt-BR', 'por-br': 'pt-BR', 'pt-pt': 'pt-PT',
  'es-la': 'es-419', 'es-lat': 'es-419', 'es-latam': 'es-419', 'spa-la': 'es-419', ea: 'es-419',
  chs: 'zh-Hans', cht: 'zh-Hant', zhs: 'zh-Hans', zht: 'zh-Hant',
};

/** Region words used in names like "Portuguese (Brazil)" / "Spanish (Latin America)". */
const REGION_WORDS: Readonly<Record<string, string>> = {
  brazil: 'BR', brasil: 'BR', portugal: 'PT', 'latin america': '419', latino: '419', latam: '419', spain: 'ES',
  españa: 'ES', espana: 'ES', mexico: 'MX', méxico: 'MX', 'united states': 'US', usa: 'US', us: 'US',
  america: 'US', american: 'US', 'united kingdom': 'GB', uk: 'GB', gb: 'GB', british: 'GB', canada: 'CA',
  canadian: 'CA', france: 'FR', belgium: 'BE', switzerland: 'CH', austria: 'AT', germany: 'DE', china: 'CN',
  taiwan: 'TW', 'hong kong': 'HK', simplified: 'Hans', traditional: 'Hant', australia: 'AU',
};

const NO_LANGUAGE: ReadonlySet<string> = new Set([
  'und', 'unknown', 'undefined', 'undetermined', 'none', 'zxx', 'mul', 'mis', 'qaa', 'n/a', 'na',
]);

const KNOWN_ISO1: ReadonlySet<string> = new Set(
  [...Object.values(ISO639_2), ...Object.values(LANGUAGE_NAMES)].filter((c) => /^[a-z]{2}$/.test(c)),
);

/** Own-property lookup, so inputs like "constructor" never hit Object.prototype. */
const lookup = (table: Readonly<Record<string, string>>, key: string): string | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

let displayNames: Intl.DisplayNames | null | undefined;
function languageDisplayName(code: string): string | null {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    } catch {
      displayNames = null;
    }
  }
  try {
    const name = displayNames?.of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name;
  } catch {
    // Invalid tag: fall through to the local table.
  }
  const base = code.split('-')[0];
  const fromTable = Object.entries(LANGUAGE_NAMES).find(([n, c]) => c === base && /^[a-z ]+$/.test(n))?.[0];
  return fromTable ? fromTable.replace(/\b\w/g, (ch) => ch.toUpperCase()) : null;
}

/** Maps the primary subtag (2/3 letters or a language name) to a code, or null. */
function baseLanguage(raw: string): string | null {
  const named = lookup(LANGUAGE_NAMES, raw);
  if (named) return named;
  if (/^[a-z]{3}$/.test(raw)) return lookup(ISO639_2, raw) ?? null;
  if (/^[a-z]{2}$/.test(raw)) {
    if (KNOWN_ISO1.has(raw)) return raw;
    const name = languageDisplayName(raw);
    return name ? raw : null;
  }
  return null;
}

function canonical(tag: string): string {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? tag;
  } catch {
    return tag;
  }
}

function withInfo(code: string | null): { code: string | null; name: string | null } {
  if (!code) return { code: null, name: null };
  const normalized = canonical(code);
  return { code: normalized, name: languageDisplayName(normalized) };
}

/**
 * Normalises a language tag or name: "en", "eng", "English", "français", "pt-BR", "pt_BR",
 * "Brazilian", "zh-Hans", "es-419", "Portuguese (Brazil)"... -> ISO 639-1 code (plus optional
 * region/script) and an English display name. Unknown / undetermined -> nulls.
 */
export function languageInfo(tag: string | null | undefined): { code: string | null; name: string | null } {
  if (typeof tag !== 'string') return { code: null, name: null };
  const raw = tag.trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ');
  if (raw === '' || NO_LANGUAGE.has(raw)) return { code: null, name: null };
  const special = lookup(SPECIAL_TAGS, raw);
  if (special) return withInfo(special);

  const direct = baseLanguage(raw);
  if (direct) return withInfo(direct);

  // "Portuguese (Brazil)", "English [US]"
  const paren = /^(.+?)\s*[([]\s*([^)\]]+?)\s*[)\]]$/.exec(raw);
  if (paren) {
    const base = baseLanguage(paren[1]) ?? lookup(SPECIAL_TAGS, paren[1]) ?? null;
    if (base) {
      const region = lookup(REGION_WORDS, paren[2]) ?? (/^[a-z]{2}$/.test(paren[2]) ? paren[2].toUpperCase() : null);
      return withInfo(region && !base.includes('-') ? `${base}-${region}` : base);
    }
  }

  // BCP 47-ish: language + script and/or region ("pt-br", "zh-hans", "es-419", "eng-us", "zh-hant-tw").
  const parts = raw.split('-');
  if (parts.length >= 2) {
    const base = baseLanguage(parts[0]);
    if (base && !base.includes('-')) {
      const rest = parts.slice(1).filter((p) => /^(?:[a-z]{2}|\d{3}|[a-z]{4})$/.test(p));
      if (rest.length === parts.length - 1) return withInfo([base, ...rest].join('-'));
      return withInfo(base);
    }
  }
  return { code: null, name: null };
}

// ---------------------------------------------------------------------------
// Sidecar subtitles
// ---------------------------------------------------------------------------

const FORCED_TOKENS: ReadonlySet<string> = new Set(['forced', 'foreign']);
const SDH_TOKENS: ReadonlySet<string> = new Set(['sdh', 'cc', 'hi', 'hoh', 'hearing', 'impaired']);
const NOISE_TOKENS: ReadonlySet<string> = new Set([
  'default', 'full', 'sub', 'subs', 'subtitle', 'subtitles', 'track', 'dialog', 'dialogue', 'text', 'srt',
]);
const SUBS_DIR_RE = /^(?:subs|subtitles|sub|subtitle)$/i;
const MAX_DERIVED_LABEL = 30;

/** Picks the path flavour matching the video path so Windows paths work on any host. */
function pathApi(p: string): path.PlatformPath {
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || (p.includes('\\') && !p.includes('/'))) return path.win32;
  return path.posix;
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

interface SubtitleTokens {
  language: { code: string | null; name: string | null };
  forced: boolean;
  sdh: boolean;
  leftovers: string[];
}

/**
 * Reads language / flags from name tokens, scanning from the end ("Movie.en.forced" ->
 * en + forced, "2_English" -> English). Unless `codesAnywhere` (tokens that follow the video's
 * own name), short codes are only trusted in trailing position so that "It.Follows" is not
 * Italian; full names ("English") are accepted anywhere.
 */
function analyzeTokens(tokens: string[], codesAnywhere = false): SubtitleTokens {
  const out: SubtitleTokens = { language: { code: null, name: null }, forced: false, sdh: false, leftovers: [] };
  let trailing = true;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    const t = token.toLowerCase();
    if (FORCED_TOKENS.has(t)) {
      out.forced = true;
      continue;
    }
    if (SDH_TOKENS.has(t)) {
      out.sdh = true;
      continue;
    }
    if (NOISE_TOKENS.has(t) || /^\d{1,2}$/.test(t)) continue;
    if (out.language.code === null) {
      // Region pairs split by the tokenizer: "pt" + "BR", "zh" + "Hans", "es" + "419".
      const codesOk = trailing || codesAnywhere;
      if (codesOk && i > 0 && /^(?:[a-z]{2}|\d{3}|[a-z]{4})$/i.test(token) && /^[a-z]{2,3}$/i.test(tokens[i - 1])) {
        const pair = languageInfo(`${tokens[i - 1]}-${token}`);
        if (pair.code?.includes('-')) {
          out.language = pair;
          i--;
          continue;
        }
      }
      if (codesOk || t.length > 3) {
        const info = languageInfo(token);
        if (info.code) {
          out.language = info;
          continue;
        }
      }
    }
    trailing = false;
    out.leftovers.unshift(token);
  }
  return out;
}

function tokenize(text: string): string[] {
  return text.split(/[._\- ]+/).filter(Boolean);
}

function sidecarLabel(info: SubtitleTokens): string {
  let label = info.language.name;
  if (!label) {
    const derived = info.leftovers.join(' ').trim();
    label = derived && derived.length <= MAX_DERIVED_LABEL && info.leftovers.length <= 3 ? derived : 'Unknown';
  }
  if (info.forced) label += ' (Forced)';
  if (info.sdh) label += ' [CC]';
  return label;
}

function isNameBoundary(ch: string | undefined): boolean {
  return ch === undefined || /[._\- [(]/.test(ch);
}

async function safeList(listDir: (dir: string) => Promise<string[]>, dir: string): Promise<string[]> {
  try {
    const entries = await listDir(dir);
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/**
 * Finds subtitle files belonging to a video: same-prefix files next to it ("Movie.en.srt"),
 * any subtitle when the folder holds a single video ("English.srt"), and files in a Subs /
 * Subtitles folder, including scene-style "Subs/<video name>/2_English.srt".
 */
export async function findSidecarSubtitles(
  videoPath: string,
  listDir: (dir: string) => Promise<string[]>,
): Promise<StoredSubtitle[]> {
  const P = pathApi(videoPath);
  const dir = P.dirname(videoPath);
  const videoName = P.basename(videoPath);
  const videoBase = stemOf(videoName);
  const baseLower = videoBase.toLowerCase();
  const entries = await safeList(listDir, dir);

  const videos = entries.filter((e) => isVideoFile(e) && !isExtraOrSample(e, 0));
  const otherBases = videos
    .filter((v) => v.toLowerCase() !== videoName.toLowerCase())
    .map((v) => stemOf(v).toLowerCase());
  const singleVideo = otherBases.length === 0;

  /** Our video is the longest video name that prefixes this subtitle name. */
  const ownsByName = (stem: string): boolean => {
    const s = stem.toLowerCase();
    if (!s.startsWith(baseLower) || !isNameBoundary(s[baseLower.length])) return false;
    return !otherBases.some((b) => b.length > baseLower.length && s.startsWith(b) && isNameBoundary(s[b.length]));
  };

  const found = new Map<string, StoredSubtitle>();
  const add = (fullPath: string, format: SubtitleFormat, info: SubtitleTokens): void => {
    if (found.has(fullPath)) return;
    found.set(fullPath, {
      id: `sc-${hashId(fullPath).slice(0, 10)}`,
      source: 'sidecar',
      path: fullPath,
      format,
      language: info.language.code,
      label: sidecarLabel(info),
      forced: info.forced,
      sdh: info.sdh,
    });
  };
  const consider = (folder: string, name: string): void => {
    const format = subtitleFormatFromPath(name);
    if (!format) return;
    const stem = stemOf(name);
    if (ownsByName(stem)) add(P.join(folder, name), format, analyzeTokens(tokenize(stem.slice(videoBase.length)), true));
    else if (singleVideo) add(P.join(folder, name), format, analyzeTokens(tokenize(stem)));
  };

  for (const name of entries) consider(dir, name);

  for (const subsDir of entries.filter((e) => SUBS_DIR_RE.test(e))) {
    const subsPath = P.join(dir, subsDir);
    for (const name of await safeList(listDir, subsPath)) {
      if (subtitleFormatFromPath(name)) {
        consider(subsPath, name);
      } else if (name.toLowerCase() === baseLower) {
        const nested = P.join(subsPath, name);
        for (const inner of await safeList(listDir, nested)) {
          const format = subtitleFormatFromPath(inner);
          if (format) add(P.join(nested, inner), format, analyzeTokens(tokenize(stemOf(inner))));
        }
      }
    }
  }

  return [...found.values()].sort(
    (a, b) => Number(a.forced) - Number(b.forced) || a.label.localeCompare(b.label) || (a.path ?? '').localeCompare(b.path ?? ''),
  );
}

// ---------------------------------------------------------------------------
// Embedded subtitle streams
// ---------------------------------------------------------------------------

/** Text codecs the browser path can use (image subtitles like PGS / VobSub need OCR or burn-in). */
const TEXT_SUBTITLE_CODECS: ReadonlySet<string> = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text']);

export function embeddedSubtitleTracks(subs: ProbeSubtitle[]): StoredSubtitle[] {
  return subs
    .filter((s) => TEXT_SUBTITLE_CODECS.has((s.codec ?? '').toLowerCase()))
    .map((s) => {
      const lang = languageInfo(s.language);
      const title = s.title?.trim() || null;
      const forced = s.forced || /\bforced\b/i.test(title ?? '');
      const sdh = /\b(?:sdh|cc|hi|hoh|hearing[ -]impaired)\b/i.test(title ?? '');
      let label = lang.name ?? title ?? `Track ${s.index + 1}`;
      if (forced && !/forced/i.test(label)) label += ' (Forced)';
      if (sdh && lang.name) label += ' [CC]';
      return {
        id: `emb-${s.index}`,
        source: 'embedded' as const,
        streamIndex: s.index,
        format: 'embedded' as const,
        language: lang.code,
        label,
        forced,
        sdh,
      };
    });
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  if (!bigEndian) return new TextDecoder('utf-16le').decode(bytes);
  const swapped = new Uint8Array(bytes.length - (bytes.length % 2));
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    swapped[i] = bytes[i + 1];
    swapped[i + 1] = bytes[i];
  }
  return new TextDecoder('utf-16le').decode(swapped);
}

/** BOM sniffing (UTF-8 / UTF-16 LE / BE), then strict UTF-8, then Windows-1252. */
export function decodeSubtitleBuffer(buf: Buffer | Uint8Array): string {
  const b: Uint8Array = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return stripBom(new TextDecoder('utf-8').decode(b.subarray(3)));
  }
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return stripBom(decodeUtf16(b.subarray(2), false));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return stripBom(decodeUtf16(b.subarray(2), true));
  // BOM-less UTF-16 of mostly-ASCII text: every other byte is zero.
  if (b.length >= 4 && b[0] !== 0 && b[1] === 0 && b[2] !== 0 && b[3] === 0) return stripBom(decodeUtf16(b, false));
  if (b.length >= 4 && b[0] === 0 && b[1] !== 0 && b[2] === 0 && b[3] !== 0) return stripBom(decodeUtf16(b, true));
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(b));
  } catch {
    return stripBom(new TextDecoder('windows-1252').decode(b));
  }
}

// ---------------------------------------------------------------------------
// Cue text cleanup
// ---------------------------------------------------------------------------

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '', rlm: '', quot: '"', apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole: string, ent: string) => {
    const e = ent.toLowerCase();
    if (e.startsWith('#')) {
      const cp = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return lookup(ENTITIES, e) ?? whole;
  });
}

/**
 * ASS override blocks: {\i1}..{\i0} (and \b, \u) become <i>..</i>; every other override is
 * dropped. Brace blocks without a backslash are ASS comments ('all') or literal text ('overrides').
 */
function convertAssOverrides(s: string, braces: 'all' | 'overrides'): string {
  return s.replace(/\{([^{}]*)\}/g, (whole: string, inner: string) => {
    if (!inner.includes('\\')) return braces === 'all' ? '' : whole;
    let out = '';
    for (const m of inner.matchAll(/\\([ibu])(\d+)?(?![a-z])/gi)) {
      const tag = m[1].toLowerCase();
      const n = m[2] === undefined ? 0 : Number(m[2]);
      const on = tag === 'b' ? n === 1 || n >= 700 : n === 1;
      out += on ? `<${tag}>` : `</${tag}>`;
    }
    return out;
  });
}

/** Keeps opening/closing <i>/<b>/<u> in order: drops stray closers, closes what is left open. */
function balanceTags(s: string): string {
  const open: string[] = [];
  let out = s.replace(/<(\/?)([ibu])>/g, (tag: string, close: string, name: string) => {
    if (!close) {
      open.push(name);
      return tag;
    }
    const idx = open.lastIndexOf(name);
    if (idx < 0) return '';
    open.splice(idx, 1);
    return tag;
  });
  for (let i = open.length - 1; i >= 0; i--) out += `</${open[i]}>`;
  let prev = '';
  while (prev !== out) {
    prev = out;
    out = out.replace(/<([ibu])>(\s*)<\/\1>/g, '$2');
  }
  return out;
}

const ALLOWED_TAG_RE = /^<(\/?)([ibu])(?:[.\s][^>]*)?>$/i;

function cleanCueText(raw: string, braces: 'all' | 'overrides'): string {
  let s = convertAssOverrides(raw.replace(/\r\n?/g, '\n'), braces);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Only <i>, <b>, <u> survive; <font>, <v Bob>, <c.yellow>, <00:00:01.000>, <ruby>... are dropped.
  s = s.replace(/<\/?[a-z][^<>]*>|<\d{1,2}:\d{2}[^<>]*>/gi, (tag: string) => {
    const m = ALLOWED_TAG_RE.exec(tag);
    return m ? `<${m[1]}${m[2].toLowerCase()}>` : '';
  });
  s = decodeEntities(s)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
  s = balanceTags(s).trim();
  return s.replace(/<\/?[ibu]>/g, '').trim() === '' ? '' : s;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

const TIMESTAMP_SRC = '(?:\\d+:)?\\d{1,2}:\\d{1,2}(?:[,.:]\\d{1,3})?';
const SRT_TIMING_RE = new RegExp(`^\\s*(${TIMESTAMP_SRC})\\s*-{1,2}>\\s*(${TIMESTAMP_SRC})`);
const VTT_TIMING_RE = new RegExp(`^\\s*(${TIMESTAMP_SRC})\\s*-->\\s*(${TIMESTAMP_SRC})(?:\\s|$)`);

/** "01:02:03,456", "02:03.456", "1:02:03.45" (ASS centiseconds), "00:01,5" -> seconds. */
function parseTimestamp(ts: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.:](\d{1,3}))?\s*$/.exec(ts);
  if (!m) return null;
  const seconds = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0);
  return Math.round(seconds * 1000) / 1000;
}

function pushCue(cues: SubtitleCue[], start: number, end: number, raw: string, braces: 'all' | 'overrides'): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  const text = cleanCueText(raw, braces);
  if (text !== '') cues.push({ start, end, text });
}

interface PendingCue {
  start: number;
  end: number;
  lines: string[];
}

function finishSrtCue(cues: SubtitleCue[], cue: PendingCue, atEof: boolean): void {
  const lines = cue.lines;
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (!atEof && lines.length > 1) {
    const last = lines[lines.length - 1];
    const afterBlank = lines[lines.length - 2].trim() === '';
    // The next cue's index line (possibly garbled: "12a", "#12") trails the text.
    if (/^\s*\d+\s*$/.test(last) || (afterBlank && /^\s*[#\w-]*\d[\w-]*\s*$/.test(last))) lines.pop();
  }
  pushCue(cues, cue.start, cue.end, lines.join('\n'), 'overrides');
}

function parseSrt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let cur: PendingCue | null = null;
  for (const line of text.split('\n')) {
    const m = line.includes('>') ? SRT_TIMING_RE.exec(line) : null;
    if (m) {
      if (cur) finishSrtCue(cues, cur, false);
      const start = parseTimestamp(m[1]);
      const end = parseTimestamp(m[2]);
      cur = start !== null && end !== null ? { start, end, lines: [] } : null;
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  if (cur) finishSrtCue(cues, cur, true);
  return cues;
}

function parseVtt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let cur: PendingCue | null = null;
  let skipping = false; // inside the header or a NOTE / STYLE / REGION block
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      if (cur) pushCue(cues, cur.start, cur.end, cur.lines.join('\n'), 'overrides');
      cur = null;
      skipping = false;
      continue;
    }
    const m = line.includes('-->') ? VTT_TIMING_RE.exec(line) : null;
    if (m) {
      if (cur) pushCue(cues, cur.start, cur.end, cur.lines.join('\n'), 'overrides');
      const start = parseTimestamp(m[1]);
      const end = parseTimestamp(m[2]);
      cur = start !== null && end !== null ? { start, end, lines: [] } : null;
      skipping = cur === null;
      continue;
    }
    if (cur) cur.lines.push(line);
    else if (!skipping && /^(?:WEBVTT|NOTE|STYLE|REGION)(?:[\s:]|$)/.test(line.trim())) skipping = true;
    // Anything else outside a cue is a cue identifier or junk.
  }
  if (cur) pushCue(cues, cur.start, cur.end, cur.lines.join('\n'), 'overrides');
  return cues;
}

const DEFAULT_ASS_FORMAT = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];

/** Splits "a,b,c,text, with, commas" into `count` fields; the last one keeps the remainder. */
function splitAssFields(value: string, count: number): string[] {
  const out: string[] = [];
  let rest = value;
  for (let i = 0; i < count - 1; i++) {
    const comma = rest.indexOf(',');
    if (comma < 0) break;
    out.push(rest.slice(0, comma).trim());
    rest = rest.slice(comma + 1);
  }
  out.push(rest);
  return out;
}

function parseAss(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let section = '';
  let format = DEFAULT_ASS_FORMAT;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1].trim().toLowerCase();
      continue;
    }
    if (section !== '' && section !== 'events') continue;
    if (/^format\s*:/i.test(line)) {
      const fields = line.slice(line.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase());
      if (fields.includes('start') && fields.includes('end') && fields.includes('text')) format = fields;
      continue;
    }
    if (!/^dialogue\s*:/i.test(line)) continue;
    const fields = splitAssFields(line.slice(line.indexOf(':') + 1), format.length);
    const field = (name: string): string => fields[format.indexOf(name)] ?? '';
    const start = parseTimestamp(field('start'));
    const end = parseTimestamp(field('end'));
    const body = field('text');
    if (start === null || end === null) continue;
    if (/\{[^}]*\\p[1-9]/.test(body)) continue; // vector drawing, not dialogue
    pushCue(cues, start, end, body.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' '), 'all');
  }
  return cues;
}

/**
 * Parses subtitle text into cues sorted by start time. Text keeps '\n' line breaks and only
 * <i>, <b>, <u> tags. The declared format is double-checked against the content (a ".srt" that
 * is really WebVTT or ASS still parses).
 */
export function parseSubtitles(text: string, format: SubtitleFormat): SubtitleCue[] {
  const normalized = stripBom(String(text ?? '')).replace(/\r\n?/g, '\n');
  let kind: SubtitleFormat = format;
  if (/^\s*WEBVTT(?:[\s:]|$)/.test(normalized)) kind = 'vtt';
  else if (/^\s*\[(?:script info|events|v4\+? styles)\]/im.test(normalized) && /^\s*dialogue\s*:/im.test(normalized)) {
    kind = 'ass';
  }
  let cues: SubtitleCue[];
  try {
    cues = kind === 'vtt' ? parseVtt(normalized) : kind === 'srt' ? parseSrt(normalized) : parseAss(normalized);
  } catch {
    cues = [];
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}
