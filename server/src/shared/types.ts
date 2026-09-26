/**
 * API contract shared by the server and the web client.
 * Only types live here so the web bundle can import them without pulling server code.
 */

export type LibraryKind = 'movies' | 'shows' | 'mixed';
export type TitleKind = 'movie' | 'show';
export type ProviderId = 'tmdb' | 'tvmaze' | 'itunes' | 'omdb';
export type MetadataSource = ProviderId | 'embedded' | 'filename';
export type PlaybackMode = 'direct' | 'remux' | 'transcode';
export type Quality = 'SD' | 'HD' | '4K';

export interface LibraryDTO {
  id: string;
  name: string;
  path: string;
  kind: LibraryKind;
  createdAt: number;
  lastScanAt: number | null;
  status: 'idle' | 'queued' | 'scanning' | 'offline' | 'error';
  error: string | null;
  fileCount: number;
  titleCount: number;
}

export interface ScanProgress {
  running: boolean;
  libraryId: string | null;
  libraryName: string | null;
  phase: 'idle' | 'discovering' | 'probing' | 'metadata' | 'artwork' | 'done';
  processed: number;
  total: number;
  current: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  message: string | null;
  queue: string[];
}

/** Client-ready image URLs (already routed through the server image cache). */
export interface ImageSet {
  /** 2:3 portrait artwork. */
  poster: string | null;
  /** 16:9 textless background art, used by the billboard and the detail modal. */
  backdrop: string | null;
  /** 16:9 art for row cards; may contain the title treatment (see cardHasTitle). */
  card: string | null;
  cardHasTitle: boolean;
  /** Transparent title treatment ("logo"). */
  logo: string | null;
  /** Frame grabbed from the video file itself. */
  thumb: string | null;
}

export interface TitleSummary {
  id: string;
  kind: TitleKind;
  name: string;
  year: number | null;
  overview: string;
  genres: string[];
  /** Mood / keyword tags, e.g. "Suspenseful", "Heist". */
  tags: string[];
  /** Community rating, 0-10. */
  rating: number | null;
  popularity: number | null;
  /** Content / maturity rating, e.g. "PG-13" or "TV-MA". */
  maturity: string | null;
  /** Minutes: movie runtime or typical episode runtime. */
  runtime: number | null;
  seasonCount: number;
  episodeCount: number;
  quality: Quality | null;
  images: ImageSet;
  addedAt: number;
  releaseDate: string | null;
  /** Top cast, directors, creators and studios, used for search. */
  people: string[];
  libraryIds: string[];
  /** Default file to play: the movie file or the first episode. */
  playFileId: string | null;
  /** Muted autoplay preview URL (direct-playable or cheaply remuxable files only). */
  previewUrl: string | null;
  source: MetadataSource;
  /** False when every file of this title lives on an offline library. */
  available: boolean;
}

export interface CastMember {
  name: string;
  character: string | null;
  photo: string | null;
}

export interface EpisodeDTO {
  /** Same as fileId. */
  id: string;
  fileId: string;
  season: number;
  episode: number;
  episodeEnd: number | null;
  name: string;
  overview: string;
  still: string | null;
  /** Minutes (from metadata). */
  runtime: number | null;
  airDate: string | null;
  /** Seconds (from the file). */
  duration: number | null;
}

export interface SeasonDTO {
  number: number;
  name: string;
  overview: string;
  poster: string | null;
  episodes: EpisodeDTO[];
}

export interface SubtitleTrack {
  id: string;
  label: string;
  language: string | null;
  forced: boolean;
  source: 'sidecar' | 'embedded';
}

export interface AudioTrack {
  /** Index among the file's audio streams (0-based). */
  index: number;
  label: string;
  language: string | null;
  codec: string;
  channels: number | null;
  default: boolean;
}

export interface FileDTO {
  id: string;
  path: string;
  size: number;
  container: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodecs: string[];
  subtitles: SubtitleTrack[];
  libraryId: string;
}

export interface ExternalIds {
  tmdb?: number;
  imdb?: string;
  tvmaze?: number;
  tvdb?: number;
  itunes?: number;
}

export interface TitleDetail extends TitleSummary {
  tagline: string | null;
  cast: CastMember[];
  directors: string[];
  writers: string[];
  creators: string[];
  studios: string[];
  /** Shows only. */
  seasons: SeasonDTO[];
  /** Movie files (multiple versions / parts) or all episode files. */
  files: FileDTO[];
  externalIds: ExternalIds;
  /** Ids of similar titles in the library. */
  similar: string[];
  locked: boolean;
  metadataStatus: 'pending' | 'matched' | 'unmatched' | 'error';
}

export interface PlaybackInfo {
  fileId: string;
  titleId: string;
  title: TitleSummary;
  episode: EpisodeDTO | null;
  next: EpisodeDTO | null;
  mode: PlaybackMode;
  /** Direct: final URL. Remux/transcode: base URL; the client appends `start` (seconds). */
  url: string;
  canTranscode: boolean;
  /** Seconds. */
  duration: number | null;
  subtitles: SubtitleTrack[];
  audioTracks: AudioTrack[];
  /** Seconds to resume from (0 = beginning). */
  resumeAt: number;
  /** Scrubber thumbnail previews available. */
  hasFrames: boolean;
  reason: string | null;
}

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export interface ProgressEntry {
  fileId: string;
  titleId: string;
  position: number;
  duration: number;
  updatedAt: number;
  finished: boolean;
}

export type ThumbRating = -1 | 1 | 2;

/** An entry of the "Continue Watching" row. */
export interface ContinueItem {
  titleId: string;
  fileId: string;
  /** Seconds. */
  position: number;
  /** Seconds. */
  duration: number;
  /** 0..1 */
  progress: number;
  episode: EpisodeDTO | null;
  updatedAt: number;
  /** The next episode after a finished one. */
  upNext: boolean;
}

export interface ProfileDTO {
  id: string;
  name: string;
  avatar: string;
  kids: boolean;
  autoplayNext: boolean;
  autoplayPreviews: boolean;
  subtitleLang: string | null;
  createdAt: number;
}

export interface ProfileState {
  /** Title ids, most recently added first. */
  myList: string[];
  ratings: Record<string, ThumbRating>;
  /** Keyed by file id. */
  progress: Record<string, ProgressEntry>;
  /** Title ids hidden from "Continue Watching". */
  hiddenFromContinue: string[];
}

export interface SettingsDTO {
  tmdbApiKey: string;
  omdbApiKey: string;
  /** e.g. "en-US". */
  metadataLanguage: string;
  /** ISO 3166-1 country used for certifications / store lookups, e.g. "US". */
  region: string;
  useTvmaze: boolean;
  useItunes: boolean;
  /** 0 disables periodic rescans. */
  autoScanMinutes: number;
  transcoding: boolean;
  hwAccel: 'none' | 'vaapi' | 'nvenc' | 'qsv' | 'videotoolbox';
  generateThumbnails: boolean;
  /** True when the TMDB key comes from the TMDB_API_KEY env var. */
  tmdbFromEnv?: boolean;
  omdbFromEnv?: boolean;
}

export interface SystemInfo {
  version: string;
  platform: string;
  dataDir: string;
  ffmpeg: { available: boolean; version: string | null; path: string | null };
  ffprobe: { available: boolean; path: string | null };
  titleCount: number;
  fileCount: number;
  libraryCount: number;
  authRequired: boolean;
  /** False until the first-run setup has been completed or skipped. */
  onboarded: boolean;
}

export interface MatchCandidate {
  provider: ProviderId;
  id: string;
  kind: TitleKind;
  name: string;
  year: number | null;
  overview: string;
  poster: string | null;
  score?: number;
}

export interface FsRoot {
  name: string;
  path: string;
  kind: 'drive' | 'mount' | 'home' | 'network' | 'root';
}

export interface FsListing {
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
  videoCount: number;
}

export interface FsCheckResult {
  ok: boolean;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  videoCount: number;
  error: string | null;
}

export type ServerEvent =
  | { type: 'scan'; progress: ScanProgress }
  | { type: 'library'; at: number }
  | { type: 'libraries'; at: number }
  | { type: 'hello'; at: number };
