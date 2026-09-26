import type {
  CastMember,
  ExternalIds,
  LibraryKind,
  MetadataSource,
  ProfileDTO,
  ProfileState,
  ProviderId,
  SettingsDTO,
  TitleKind,
} from './shared/types.js';

/** Result of parsing a video's relative path (folders + file name). */
export interface ParsedName {
  kind: 'movie' | 'episode';
  /** Movie title, or show name for episodes. Cleaned and human readable. */
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  /** Last episode of a multi-episode file (S01E01-E02 -> 2). */
  episodeEnd: number | null;
  episodeTitle: string | null;
  /** YYYY-MM-DD for date-based episodes (daily shows). */
  airDate: string | null;
  imdbId: string | null;
  tmdbId: number | null;
  tvdbId: number | null;
  /** 'Director's Cut', 'Extended', ... */
  edition: string | null;
  /** '2160p', '1080p', '720p', '480p' ... when present in the name. */
  resolution: string | null;
  /** cd1 / part1 / disc1 -> 1 */
  part: number | null;
}

export interface ProbeVideo {
  codec: string;
  profile: string | null;
  width: number;
  height: number;
  pixFmt: string | null;
  bitDepth: number | null;
  hdr: boolean;
}

export interface ProbeAudio {
  /** Index among audio streams (0-based). */
  index: number;
  codec: string;
  channels: number | null;
  language: string | null;
  title: string | null;
  default: boolean;
}

export interface ProbeSubtitle {
  /** Index among subtitle streams (0-based). */
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  forced: boolean;
  default: boolean;
}

export interface ProbeInfo {
  duration: number | null;
  container: string | null;
  bitrate: number | null;
  video: ProbeVideo | null;
  audio: ProbeAudio[];
  subtitles: ProbeSubtitle[];
  source: 'ffprobe' | 'music-metadata';
}

/** Metadata tags embedded in the file (ID3, MP4/iTunes atoms, Matroska tags, RIFF INFO...). */
export interface EmbeddedTags {
  title?: string;
  year?: number;
  date?: string;
  genres?: string[];
  description?: string;
  show?: string;
  season?: number;
  episode?: number;
  episodeId?: string;
  network?: string;
  artist?: string;
  comment?: string;
  imdbId?: string;
}

export interface StoredSubtitle {
  id: string;
  source: 'sidecar' | 'embedded';
  /** Sidecar: absolute path. */
  path?: string;
  /** Embedded: index among subtitle streams. */
  streamIndex?: number;
  format: 'srt' | 'vtt' | 'ass' | 'ssa' | 'embedded';
  language: string | null;
  label: string;
  forced: boolean;
  sdh: boolean;
}

export interface StoredFile {
  id: string;
  libraryId: string;
  path: string;
  relPath: string;
  size: number;
  mtimeMs: number;
  ext: string;
  titleId: string;
  parsed: ParsedName;
  probe: ProbeInfo | null;
  tags: EmbeddedTags | null;
  /** Image ref of embedded cover art (local:...). */
  cover: string | null;
  /** Image ref of a frame grabbed with ffmpeg (local:...). */
  thumb: string | null;
  thumbAttempted?: boolean;
  subtitles: StoredSubtitle[];
  addedAt: number;
  updatedAt: number;
}

/** Image references: either an absolute remote URL or `local:<file name in the image cache>`. */
export interface StoredImages {
  poster: string | null;
  backdrop: string | null;
  card: string | null;
  cardHasTitle: boolean;
  logo: string | null;
}

export interface EpisodeMeta {
  name: string;
  overview: string;
  still: string | null;
  airDate: string | null;
  runtime: number | null;
}

export interface SeasonMeta {
  name: string;
  overview: string;
  poster: string | null;
}

export interface StoredTitle {
  id: string;
  kind: TitleKind;
  /** Name/year as parsed from files, used as the metadata search query. */
  parsedName: string;
  parsedYear: number | null;
  name: string;
  sortName: string;
  year: number | null;
  overview: string;
  tagline: string | null;
  genres: string[];
  tags: string[];
  rating: number | null;
  voteCount: number | null;
  popularity: number | null;
  maturity: string | null;
  runtime: number | null;
  releaseDate: string | null;
  images: StoredImages;
  cast: CastMember[];
  directors: string[];
  writers: string[];
  creators: string[];
  studios: string[];
  externalIds: ExternalIds;
  seasons: Record<string, SeasonMeta>;
  /** Keyed by "S<season>E<episode>", e.g. "S1E2". */
  episodes: Record<string, EpisodeMeta>;
  metadata: {
    status: 'pending' | 'matched' | 'unmatched' | 'error';
    source: MetadataSource;
    fetchedAt: number | null;
    locked: boolean;
    error: string | null;
    attempts: number;
    /** Seasons whose episode metadata has been fetched. */
    seasonsFetched: number[];
  };
  addedAt: number;
  updatedAt: number;
}

export interface LibraryData {
  version: number;
  files: Record<string, StoredFile>;
  titles: Record<string, StoredTitle>;
  /** Grouping key ("movie:the matrix:1999" / "show:breaking bad") -> title id. */
  groups: Record<string, string>;
}

export interface StoredLibrary {
  id: string;
  name: string;
  path: string;
  kind: LibraryKind;
  createdAt: number;
  lastScanAt: number | null;
  status: 'idle' | 'queued' | 'scanning' | 'offline' | 'error';
  error: string | null;
}

export interface StoredProfile extends ProfileDTO {
  state: ProfileState;
}

export interface StateData {
  version: number;
  settings: SettingsDTO;
  libraries: StoredLibrary[];
  profiles: StoredProfile[];
  onboarded: boolean;
  /** Random secret used to sign auth cookies. */
  secret: string;
}

// ---------------------------------------------------------------------------
// Metadata providers
// ---------------------------------------------------------------------------

export interface SearchQuery {
  kind: TitleKind;
  name: string;
  year?: number | null;
}

export interface ProviderCandidate {
  provider: ProviderId;
  id: string;
  kind: TitleKind;
  name: string;
  originalName: string | null;
  year: number | null;
  overview: string;
  /** Remote poster URL. */
  poster: string | null;
  popularity: number | null;
}

/** Normalised full metadata for a movie or a show, as returned by a provider. */
export interface ProviderTitle {
  provider: ProviderId;
  providerId: string;
  kind: TitleKind;
  name: string;
  originalName: string | null;
  year: number | null;
  releaseDate: string | null;
  overview: string;
  tagline: string | null;
  genres: string[];
  tags: string[];
  rating: number | null;
  voteCount: number | null;
  popularity: number | null;
  maturity: string | null;
  runtime: number | null;
  /** Remote URLs. */
  images: StoredImages;
  cast: CastMember[];
  directors: string[];
  writers: string[];
  creators: string[];
  studios: string[];
  externalIds: ExternalIds;
  /** Shows only: season number -> season info. */
  seasons: Record<string, SeasonMeta>;
}

export interface ProviderEpisode {
  season: number;
  episode: number;
  name: string;
  overview: string;
  still: string | null;
  airDate: string | null;
  runtime: number | null;
}

export interface ProviderContext {
  settings: SettingsDTO;
  fetchJson: FetchJson;
}

export type FetchJson = <T = unknown>(
  url: string,
  init?: { headers?: Record<string, string>; limiter?: string; allow404?: boolean },
) => Promise<T | null>;

export interface MetadataProvider {
  id: ProviderId;
  supports(kind: TitleKind): boolean;
  isEnabled(settings: SettingsDTO): boolean;
  search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderCandidate[]>;
  getDetails(id: string, kind: TitleKind, ctx: ProviderContext): Promise<ProviderTitle | null>;
  /** Shows only: episode metadata for the given seasons. */
  getEpisodes?(id: string, seasons: number[], ctx: ProviderContext): Promise<ProviderEpisode[]>;
  /** Resolve an external id (IMDb / TVDB) to this provider's id. */
  findByExternalId?(ids: ExternalIds, kind: TitleKind, ctx: ProviderContext): Promise<string | null>;
}
