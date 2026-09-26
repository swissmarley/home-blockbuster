import type { EpisodeDTO, TitleSummary } from '@shared/types';

export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "2h 14m" for movies, "3 Seasons" / "8 Episodes" for shows. */
export function lengthLabel(t: Pick<TitleSummary, 'kind' | 'runtime' | 'seasonCount' | 'episodeCount'>): string | null {
  if (t.kind === 'movie') return formatRuntime(t.runtime);
  if (t.seasonCount > 1) return `${t.seasonCount} Seasons`;
  if (t.episodeCount > 1) return `${t.episodeCount} Episodes`;
  if (t.episodeCount === 1) return '1 Episode';
  return null;
}

/** 83 -> "1:23", 3723 -> "1:02:03". */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

/** "43 of 58m" style progress text. */
export function progressLabel(position: number, duration: number): string | null {
  if (!duration) return null;
  const total = Math.max(1, Math.round(duration / 60));
  const done = Math.round(position / 60);
  if (total >= 60) {
    const left = Math.max(1, Math.round((duration - position) / 60));
    return `${formatRuntime(left)} left`;
  }
  return `${done} of ${total}m`;
}

export function episodeCode(ep: Pick<EpisodeDTO, 'season' | 'episode'>): string {
  return ep.season === 0 ? `Special ${ep.episode}` : `S${ep.season}:E${ep.episode}`;
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString();
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 2 : 0)} ${units[i]}`;
}

export function isRecentlyAdded(t: Pick<TitleSummary, 'addedAt'>, days = 14): boolean {
  return Date.now() - t.addedAt < days * 24 * 60 * 60 * 1000;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).trim()}…`;
}
