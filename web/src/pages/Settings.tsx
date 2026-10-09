import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useSearchParams } from 'react-router-dom';
import type { LibraryDTO, SettingsDTO, TitleSummary } from '@shared/types';
import { api } from '../api/client';
import { Avatar } from '../components/Avatar';
import { FixMatchDialog } from '../components/FixMatchDialog';
import {
  CloseIcon,
  DriveIcon,
  ExternalIcon,
  FilmIcon,
  FolderIcon,
  HelpIcon,
  LayersIcon,
  LockIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  ServerIcon,
  TrashIcon,
  TvIcon,
} from '../components/Icons';
import { Logo } from '../components/Logo';
import { PasswordForm } from '../components/PasswordForm';
import { relativeTime } from '../lib/format';
import { useApp, useCurrentProfile } from '../store/app';
import { LibraryForm } from './LibraryForm';
import './Settings.css';

const PHASE_LABEL: Record<string, string> = {
  discovering: 'Looking for videos',
  probing: 'Reading files, tags & cover art',
  metadata: 'Fetching metadata & artwork',
  artwork: 'Creating thumbnails',
};

function ScanPanel() {
  const scan = useApp((s) => s.scan);
  const libraries = useApp((s) => s.libraries);
  const toast = useApp((s) => s.toast);
  const running = Boolean(scan?.running);
  const pct = scan?.total ? Math.round((scan.processed / scan.total) * 100) : null;
  const last = Math.max(0, ...libraries.map((l) => l.lastScanAt ?? 0));
  return (
    <div className={`scan-panel ${running ? 'scan-panel--running' : ''}`}>
      <div className="scan-panel__text">
        {running ? (
          <>
            <strong>
              {PHASE_LABEL[scan!.phase] ?? 'Scanning'} · {scan!.libraryName}
            </strong>
            <span>{scan!.current ?? scan!.message ?? ''}</span>
          </>
        ) : (
          <>
            <strong>{libraries.length ? 'Your libraries are up to date' : 'No libraries yet'}</strong>
            <span>{last ? `Last scan ${relativeTime(last)}` : 'Add a folder to start'}</span>
          </>
        )}
      </div>
      {running ? (
        <div className="scan-panel__bar">
          <span style={{ width: pct !== null ? `${pct}%` : '25%' }} className={pct === null ? 'is-indeterminate' : ''} />
        </div>
      ) : (
        <div className="scan-panel__actions">
          <button
            className="btn btn--grey btn--small"
            disabled={!libraries.length}
            onClick={() => api.scanAll().then(() => toast('Scanning all libraries…')).catch(() => undefined)}
          >
            <RefreshIcon /> Scan all libraries
          </button>
        </div>
      )}
    </div>
  );
}

function libraryIcon(lib: LibraryDTO) {
  const p = lib.path.toLowerCase();
  if (p.startsWith('\\\\') || /\/(mnt|nas|net|nfs|smb|share|volume\d)\b/.test(p)) return ServerIcon;
  if (p.startsWith('/volumes/') || p.startsWith('/media/') || p.startsWith('/run/media/') || /^[d-z]:\\/.test(p)) return DriveIcon;
  return lib.kind === 'shows' ? TvIcon : lib.kind === 'movies' ? FilmIcon : LayersIcon;
}

const STATUS_LABEL: Record<LibraryDTO['status'], string> = {
  idle: 'Ready',
  queued: 'Queued',
  scanning: 'Scanning…',
  offline: 'Offline',
  error: 'Error',
};

function LibrariesSettings() {
  const libraries = useApp((s) => s.libraries);
  const loadLibraries = useApp((s) => s.loadLibraries);
  const toast = useApp((s) => s.toast);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<LibraryDTO | 'new' | null>(params.get('add') ? 'new' : null);

  useEffect(() => {
    void loadLibraries();
  }, [loadLibraries]);

  const remove = async (lib: LibraryDTO): Promise<void> => {
    if (!window.confirm(`Remove "${lib.name}" from Home Blockbuster?\n\nYour video files are not touched; only the library entry and its metadata are removed.`)) return;
    try {
      await api.removeLibrary(lib.id);
      await loadLibraries();
      toast(`Removed ${lib.name}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove library', 'error');
    }
  };

  const closeEditor = (): void => {
    setEditing(null);
    if (params.has('add')) setParams({}, { replace: true });
  };

  return (
    <section className="settings-section">
      <h1>Media Libraries</h1>
      <p className="settings-lead">
        Add folders from this computer, an internal or external drive, a server or a NAS. Home Blockbuster reads your files in place — it never moves,
        renames or modifies them.
      </p>
      <ScanPanel />
      <div className="lib-list">
        {libraries.map((lib) => {
          const Icon = libraryIcon(lib);
          return (
            <div key={lib.id} className={`lib-card lib-card--${lib.status}`}>
              <div className="lib-card__icon">
                <Icon />
              </div>
              <div className="lib-card__body">
                <div className="lib-card__title">
                  <strong>{lib.name}</strong>
                  <span className={`lib-badge lib-badge--${lib.status}`}>{STATUS_LABEL[lib.status]}</span>
                  <span className="lib-kind">{lib.kind === 'movies' ? 'Movies' : lib.kind === 'shows' ? 'TV Shows' : 'Mixed'}</span>
                </div>
                <code className="lib-card__path">{lib.path}</code>
                <div className="lib-card__stats">
                  {lib.titleCount} title{lib.titleCount === 1 ? '' : 's'} · {lib.fileCount} file{lib.fileCount === 1 ? '' : 's'} · scanned{' '}
                  {relativeTime(lib.lastScanAt)}
                </div>
                {lib.error ? <p className="lib-card__error">{lib.error}</p> : null}
              </div>
              <div className="lib-card__actions">
                <button
                  className="icon-btn tip"
                  data-tip="Scan now"
                  aria-label="Scan now"
                  onClick={() => api.scanLibrary(lib.id).then(() => toast(`Scanning ${lib.name}…`)).catch(() => undefined)}
                >
                  <RefreshIcon />
                </button>
                <button className="icon-btn tip" data-tip="Edit" aria-label="Edit" onClick={() => setEditing(lib)}>
                  <PencilIcon />
                </button>
                <button className="icon-btn tip" data-tip="Remove" aria-label="Remove" onClick={() => void remove(lib)}>
                  <TrashIcon />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn btn--red" onClick={() => setEditing('new')}>
        <PlusIcon /> Add Library
      </button>

      {editing ? (
        <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeEditor()}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label={editing === 'new' ? 'Add library' : 'Edit library'}>
            <header className="dialog__head">
              <h2>{editing === 'new' ? 'Add a library' : `Edit ${editing.name}`}</h2>
              <button className="dialog__close" aria-label="Close" onClick={closeEditor}>
                <CloseIcon />
              </button>
            </header>
            <LibraryForm
              library={editing === 'new' ? null : editing}
              onCancel={closeEditor}
              onSaved={(lib) => {
                toast(editing === 'new' ? `Added ${lib.name}. Scanning…` : 'Library saved', 'success');
                closeEditor();
              }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

const LANGUAGES = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['de-DE', 'Deutsch'],
  ['de-CH', 'Deutsch (Schweiz)'],
  ['fr-FR', 'Français'],
  ['it-IT', 'Italiano'],
  ['es-ES', 'Español (España)'],
  ['es-MX', 'Español (Latinoamérica)'],
  ['pt-BR', 'Português (Brasil)'],
  ['pt-PT', 'Português (Portugal)'],
  ['nl-NL', 'Nederlands'],
  ['sv-SE', 'Svenska'],
  ['da-DK', 'Dansk'],
  ['nb-NO', 'Norsk'],
  ['fi-FI', 'Suomi'],
  ['pl-PL', 'Polski'],
  ['tr-TR', 'Türkçe'],
  ['ru-RU', 'Русский'],
  ['ja-JP', '日本語'],
  ['ko-KR', '한국어'],
  ['zh-CN', '中文 (简体)'],
] as const;

function ProviderCard({
  name,
  description,
  link,
  linkLabel,
  children,
}: {
  name: string;
  description: string;
  link?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="provider-card">
      <div className="provider-card__head">
        <strong>{name}</strong>
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="provider-card__link">
            {linkLabel ?? 'Get a free key'} <ExternalIcon />
          </a>
        ) : null}
      </div>
      <p>{description}</p>
      {children}
    </div>
  );
}

function MetadataSettings() {
  const titles = useApp((s) => s.titles);
  const toast = useApp((s) => s.toast);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [draft, setDraft] = useState<Partial<SettingsDTO>>({});
  const [saving, setSaving] = useState(false);
  const [fixing, setFixing] = useState<TitleSummary | null>(null);

  useEffect(() => {
    api.settings().then(setSettings).catch(() => undefined);
  }, []);

  const unmatched = useMemo(() => titles.filter((t) => t.source === 'filename' || t.source === 'embedded').sort((a, b) => a.name.localeCompare(b.name)), [titles]);

  if (!settings) return <div className="spinner settings-spinner" />;
  const value = <K extends keyof SettingsDTO>(k: K): SettingsDTO[K] => (draft[k] ?? settings[k]) as SettingsDTO[K];
  const set = <K extends keyof SettingsDTO>(k: K, v: SettingsDTO[K]): void => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = Object.keys(draft).length > 0;

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const saved = await api.saveSettings(draft);
      setSettings(saved);
      setDraft({});
      toast('Settings saved. Metadata will refresh in the background.', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-section">
      <h1>Metadata &amp; Artwork</h1>
      <p className="settings-lead">
        Posters, backdrops, title logos, cast, genres, episode names and stills are fetched from free services. Tags embedded in your files (MP4/iTunes
        atoms, Matroska tags, ID3) and cover art are always read first and used when nothing is found online.
      </p>

      <div className="provider-grid">
        <ProviderCard
          name="TMDB — The Movie Database"
          description="Best results for movies and shows: textless backdrops, logos, cast, keywords and episode stills. Free API key (v3 key or v4 read token)."
          link="https://www.themoviedb.org/settings/api"
        >
          <input
            className="input input--mono"
            type="password"
            autoComplete="off"
            placeholder={settings.tmdbFromEnv ? 'Set via TMDB_API_KEY' : 'Paste your TMDB API key'}
            value={value('tmdbApiKey')}
            onChange={(e) => set('tmdbApiKey', e.target.value)}
          />
          {settings.tmdbFromEnv ? <span className="field-hint">Using the key from the TMDB_API_KEY environment variable.</span> : null}
        </ProviderCard>
        <ProviderCard name="TVmaze" description="TV shows, seasons, episode names and images. No key needed." link="https://www.tvmaze.com/api" linkLabel="About">
          <label className="switch">
            <input type="checkbox" checked={value('useTvmaze')} onChange={(e) => set('useTvmaze', e.target.checked)} />
            <span>{value('useTvmaze') ? 'Enabled' : 'Disabled'}</span>
          </label>
        </ProviderCard>
        <ProviderCard
          name="iTunes Search API"
          description="Movie and TV posters, descriptions and ratings from the Apple TV store. No key needed."
          link="https://performance-partners.apple.com/search-api"
          linkLabel="About"
        >
          <label className="switch">
            <input type="checkbox" checked={value('useItunes')} onChange={(e) => set('useItunes', e.target.checked)} />
            <span>{value('useItunes') ? 'Enabled' : 'Disabled'}</span>
          </label>
        </ProviderCard>
        <ProviderCard name="OMDb" description="Posters, plots, IMDb ratings. Free key with 1,000 requests per day." link="https://www.omdbapi.com/apikey.aspx">
          <input
            className="input input--mono"
            type="password"
            autoComplete="off"
            placeholder={settings.omdbFromEnv ? 'Set via OMDB_API_KEY' : 'Paste your OMDb API key'}
            value={value('omdbApiKey')}
            onChange={(e) => set('omdbApiKey', e.target.value)}
          />
        </ProviderCard>
      </div>

      <div className="settings-row">
        <div className="field">
          <label htmlFor="meta-lang">Metadata language</label>
          <select id="meta-lang" className="select" value={value('metadataLanguage')} onChange={(e) => set('metadataLanguage', e.target.value)}>
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="meta-region">Country (maturity ratings)</label>
          <input
            id="meta-region"
            className="input settings-region"
            maxLength={2}
            value={value('region')}
            onChange={(e) => set('region', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          />
        </div>
      </div>

      <div className="settings-actions">
        <button className="btn btn--red" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn--grey" onClick={() => api.refreshMetadata(false).then(() => toast('Retrying unmatched titles…'))}>
          <RefreshIcon /> Retry unmatched
        </button>
        <button className="btn btn--grey" onClick={() => api.refreshMetadata(true).then(() => toast('Refreshing all metadata…'))}>
          <RefreshIcon /> Refresh everything
        </button>
      </div>

      <h2 className="settings-subtitle">Titles without an online match ({unmatched.length})</h2>
      {unmatched.length === 0 ? (
        <p className="settings-muted">Every title in your library has been identified.</p>
      ) : (
        <ul className="unmatched">
          {unmatched.slice(0, 200).map((t) => (
            <li key={t.id}>
              <span className="unmatched__name">
                {t.kind === 'show' ? <TvIcon /> : <FilmIcon />}
                {t.name} {t.year ? <em>({t.year})</em> : null}
              </span>
              <button className="btn btn--grey btn--small" onClick={() => setFixing(t)}>
                Fix match
              </button>
            </li>
          ))}
        </ul>
      )}
      {fixing ? (
        <FixMatchDialog
          detail={{ ...fixing, locked: false }}
          onClose={() => setFixing(null)}
          onMatched={() => setFixing(null)}
        />
      ) : null}
    </section>
  );
}

const SCAN_INTERVALS: Array<[number, string]> = [
  [0, 'Off (manual only)'],
  [60, 'Every hour'],
  [360, 'Every 6 hours'],
  [720, 'Every 12 hours'],
  [1440, 'Once a day'],
];

function PlaybackSettings() {
  const system = useApp((s) => s.system);
  const toast = useApp((s) => s.toast);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  useEffect(() => {
    api.settings().then(setSettings).catch(() => undefined);
  }, []);
  if (!settings || !system) return <div className="spinner settings-spinner" />;

  const update = async (patch: Partial<SettingsDTO>): Promise<void> => {
    setSettings({ ...settings, ...patch });
    try {
      setSettings(await api.saveSettings(patch));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save', 'error');
    }
  };

  return (
    <section className="settings-section">
      <h1>Playback</h1>
      <div className={`status-card ${system.ffmpeg.available ? 'status-card--ok' : 'status-card--warn'}`}>
        <strong>{system.ffmpeg.available ? `ffmpeg ${system.ffmpeg.version ?? ''} is installed` : 'ffmpeg was not found'}</strong>
        {system.ffmpeg.available ? (
          <p>
            Files your browser can&apos;t play (MKV, AVI, HEVC, DTS/AC3 audio…) are remuxed or transcoded on the fly. Thumbnails and scrubbing
            previews are generated from your videos. <code>{system.ffmpeg.path}</code>
          </p>
        ) : (
          <p>
            Without ffmpeg only browser-friendly files (MP4/WebM with H.264, VP9 or AV1) can play. Install it and restart the server:{' '}
            {system.platform === 'win32' ? <code>winget install Gyan.FFmpeg</code> : system.platform === 'darwin' ? <code>brew install ffmpeg</code> : <code>sudo apt install ffmpeg</code>}
            . Or set <code>FFMPEG_PATH</code>.
          </p>
        )}
      </div>

      <div className="settings-list">
        <label className="settings-item">
          <span>
            <strong>Transcode incompatible videos</strong>
            <em>Convert formats your browser can&apos;t play while you watch.</em>
          </span>
          <span className="switch">
            <input type="checkbox" checked={settings.transcoding} disabled={!system.ffmpeg.available} onChange={(e) => void update({ transcoding: e.target.checked })} />
          </span>
        </label>
        <label className="settings-item">
          <span>
            <strong>Hardware acceleration</strong>
            <em>Use your GPU for transcoding if ffmpeg supports it on this machine.</em>
          </span>
          <select className="select" value={settings.hwAccel} onChange={(e) => void update({ hwAccel: e.target.value as SettingsDTO['hwAccel'] })}>
            <option value="none">None (software)</option>
            <option value="nvenc">NVIDIA NVENC</option>
            <option value="qsv">Intel Quick Sync</option>
            <option value="vaapi">VAAPI (Intel/AMD, Linux)</option>
            <option value="videotoolbox">Apple VideoToolbox</option>
          </select>
        </label>
        <label className="settings-item">
          <span>
            <strong>Generate thumbnails</strong>
            <em>Grab frames from videos that have no artwork or episode stills.</em>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={settings.generateThumbnails}
              disabled={!system.ffmpeg.available}
              onChange={(e) => void update({ generateThumbnails: e.target.checked })}
            />
          </span>
        </label>
        <label className="settings-item">
          <span>
            <strong>Scan libraries automatically</strong>
            <em>Pick up new, changed and removed files.</em>
          </span>
          <select className="select" value={settings.autoScanMinutes} onChange={(e) => void update({ autoScanMinutes: Number(e.target.value) })}>
            {SCAN_INTERVALS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

function SecuritySettings() {
  const system = useApp((s) => s.system);
  if (!system) return <div className="spinner settings-spinner" />;
  const source = system.authSource;

  return (
    <section className="settings-section">
      <h1>Security</h1>
      <p className="settings-lead">
        A password protects every screen and the whole API, including the folder browser and these settings. Anyone who opens Home Blockbuster on a
        new device has to sign in once; profiles stay as they are.
      </p>
      <div className={`status-card ${source ? 'status-card--ok' : 'status-card--warn'}`}>
        <strong>{source ? 'Password protection is on' : 'No password is set'}</strong>
        <p>
          {source === 'env' ? (
            <>
              The password comes from the <code>HB_PASSWORD</code> setting on the server. Change or remove it there and restart.
            </>
          ) : source === 'app' ? (
            'Signed-in devices stay signed in for 30 days. Changing the password signs out every other device.'
          ) : (
            'Anyone who can reach this server on your network can browse its folders, change libraries and settings, and watch everything. Set a password if you share your network with guests, flatmates or smart devices you do not trust.'
          )}
        </p>
      </div>
      {source === 'env' ? null : <PasswordForm hasPassword={source === 'app'} />}
      <p className="settings-muted security-note">
        The Kids profile only filters what is shown; it is not a lock. Anyone using the app can switch profiles.
      </p>
    </section>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ['Space / K', 'Play or pause'],
  ['← / →', 'Back / forward 10 seconds'],
  ['↑ / ↓', 'Volume'],
  ['F', 'Full screen'],
  ['M', 'Mute'],
  ['Shift + N', 'Next episode'],
  ['Esc', 'Back to browsing'],
];

function AboutSettings() {
  const system = useApp((s) => s.system);
  const loadSystem = useApp((s) => s.loadSystem);
  useEffect(() => {
    void loadSystem();
  }, [loadSystem]);
  return (
    <section className="settings-section">
      <h1>Help &amp; About</h1>
      {system ? (
        <dl className="about-grid">
          <dt>Version</dt>
          <dd>{system.version}</dd>
          <dt>Server platform</dt>
          <dd>{system.platform}</dd>
          <dt>Data folder</dt>
          <dd>
            <code>{system.dataDir}</code>
          </dd>
          <dt>Library</dt>
          <dd>
            {system.titleCount} titles in {system.fileCount} files across {system.libraryCount} libraries
          </dd>
          <dt>ffmpeg</dt>
          <dd>{system.ffmpeg.available ? `${system.ffmpeg.version} (${system.ffmpeg.path})` : 'not installed'}</dd>
        </dl>
      ) : null}

      <h2 className="settings-subtitle">Naming your files</h2>
      <div className="help-text">
        <p>Most names work out of the box, including release names. For best results:</p>
        <pre>
          {`Movies/Inception (2010)/Inception (2010).mkv
Movies/The Matrix (1999) {imdb-tt0133093}.mp4
TV Shows/Breaking Bad (2008)/Season 01/Breaking Bad - S01E01 - Pilot.mkv
TV Shows/Doctor Who/Season 2/Doctor.Who.S02E03.720p.mkv
Subtitles: Inception (2010).en.srt, Inception (2010).de.forced.srt`}
        </pre>
      </div>

      <h2 className="settings-subtitle">Keyboard shortcuts</h2>
      <ul className="shortcut-list">
        {SHORTCUTS.map(([k, v]) => (
          <li key={k}>
            <kbd>{k}</kbd>
            <span>{v}</span>
          </li>
        ))}
      </ul>

      <h2 className="settings-subtitle">Credits</h2>
      <p className="settings-muted">
        Metadata and images are provided by TMDB, TVmaze (CC BY-SA), the iTunes Search API and OMDb. This product uses the TMDB API but is not endorsed or
        certified by TMDB. Home Blockbuster is an independent project and is not affiliated with Netflix.
      </p>
    </section>
  );
}

export function Settings() {
  const profile = useCurrentProfile();
  return (
    <div className="settings">
      <header className="settings__header">
        <Link to="/browse" className="settings__logo" aria-label="Back to browsing">
          <Logo />
        </Link>
        <div className="settings__header-right">
          <Link to="/browse" className="btn btn--grey btn--small">
            <PlayIcon /> Back to watching
          </Link>
          {profile ? <Avatar id={profile.avatar} className="settings__avatar" title={profile.name} /> : null}
        </div>
      </header>
      <div className="settings__layout">
        <nav className="settings__side" aria-label="Settings">
          <NavLink to="/settings/libraries">
            <FolderIcon /> Media Libraries
          </NavLink>
          <NavLink to="/settings/metadata">
            <LayersIcon /> Metadata &amp; Artwork
          </NavLink>
          <NavLink to="/settings/playback">
            <PlayIcon /> Playback
          </NavLink>
          <NavLink to="/settings/security">
            <LockIcon /> Security
          </NavLink>
          <NavLink to="/settings/about">
            <HelpIcon /> Help &amp; About
          </NavLink>
        </nav>
        <main className="settings__main">
          <Routes>
            <Route path="libraries" element={<LibrariesSettings />} />
            <Route path="metadata" element={<MetadataSettings />} />
            <Route path="playback" element={<PlaybackSettings />} />
            <Route path="security" element={<SecuritySettings />} />
            <Route path="about" element={<AboutSettings />} />
            <Route path="*" element={<Navigate to="/settings/libraries" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
