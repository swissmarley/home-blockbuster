import { useEffect, useState } from 'react';
import type { FsCheckResult, FsListing, FsRoot, LibraryDTO, LibraryKind } from '@shared/types';
import { api } from '../api/client';
import {
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  DriveIcon,
  FilmIcon,
  FolderIcon,
  HomeIcon,
  LayersIcon,
  ServerIcon,
  TvIcon,
  WarningIcon,
} from '../components/Icons';
import { useDebounced } from '../lib/hooks';
import { useApp } from '../store/app';
import './Settings.css';

const ROOT_ICONS: Record<FsRoot['kind'], typeof FolderIcon> = {
  drive: DriveIcon,
  mount: ServerIcon,
  home: HomeIcon,
  network: ServerIcon,
  root: FolderIcon,
};

export function FolderBrowser({ initial, onPick, onClose }: { initial: string; onPick: (path: string) => void; onClose: () => void }) {
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [manual, setManual] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async (p: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const l = await api.fsList(p);
      setListing(l);
      setManual(l.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cannot open folder');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api
      .fsRoots()
      .then((r) => {
        setRoots(r.roots);
        if (initial) void open(initial);
        else if (r.roots[0]) void open(r.roots[0].path);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="dialog-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog fb" role="dialog" aria-modal="true" aria-label="Choose a folder">
        <header className="dialog__head">
          <h2>Choose a folder</h2>
          <button className="dialog__close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <p className="fb__hint">These are folders as the Home Blockbuster server sees them, including mounted network shares and external drives.</p>
        <div className="fb__body">
          <aside className="fb__roots">
            {roots.map((r) => {
              const Icon = ROOT_ICONS[r.kind] ?? FolderIcon;
              return (
                <button key={r.path} className={listing?.path === r.path ? 'is-active' : ''} onClick={() => void open(r.path)} title={r.path}>
                  <Icon />
                  <span>{r.name}</span>
                </button>
              );
            })}
          </aside>
          <div className="fb__main">
            <form
              className="fb__bar"
              onSubmit={(e) => {
                e.preventDefault();
                void open(manual);
              }}
            >
              <button type="button" className="fb__up" aria-label="Parent folder" disabled={!listing?.parent} onClick={() => listing?.parent && void open(listing.parent)}>
                <ChevronLeftIcon />
              </button>
              <input className="input input--mono" value={manual} onChange={(e) => setManual(e.target.value)} aria-label="Folder path" spellCheck={false} />
              <button type="submit" className="btn btn--grey btn--small">
                Go
              </button>
            </form>
            {error ? <p className="error-text fb__error">{error}</p> : null}
            <ul className="fb__list">
              {loading ? <li className="fb__loading"><span className="spinner" /></li> : null}
              {!loading && listing?.entries.length === 0 ? <li className="fb__empty">No sub-folders</li> : null}
              {!loading &&
                listing?.entries.map((e) => (
                  <li key={e.path}>
                    <button onClick={() => void open(e.path)}>
                      <FolderIcon />
                      <span>{e.name}</span>
                    </button>
                  </li>
                ))}
            </ul>
            <footer className="fb__footer">
              <span>{listing ? `${listing.videoCount} video${listing.videoCount === 1 ? '' : 's'} directly in this folder` : ''}</span>
              <button className="btn btn--red" disabled={!listing} onClick={() => listing && onPick(listing.path)}>
                Select this folder
              </button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

const KINDS: Array<{ value: LibraryKind; label: string; icon: typeof FilmIcon; hint: string }> = [
  { value: 'movies', label: 'Movies', icon: FilmIcon, hint: 'One movie per file or folder' },
  { value: 'shows', label: 'TV Shows', icon: TvIcon, hint: 'Show / Season / Episode folders' },
  { value: 'mixed', label: 'Mixed', icon: LayersIcon, hint: 'Detect automatically' },
];

function NetworkTips() {
  const platform = useApp((s) => s.system?.platform);
  return (
    <details className="tips">
      <summary>Adding a NAS, server or external drive?</summary>
      <ul>
        {platform === 'win32' ? (
          <li>
            <strong>Windows:</strong> type a network path like <code>\\NAS\Movies</code> or map the share to a drive letter (e.g. <code>Z:\</code>). External
            drives appear as drive letters.
          </li>
        ) : null}
        {platform === 'darwin' ? (
          <li>
            <strong>macOS:</strong> connect the share in Finder (⌘K, <code>smb://nas.local/Movies</code>). It appears under <code>/Volumes</code>, as do
            external drives.
          </li>
        ) : null}
        {platform === 'linux' || !platform ? (
          <li>
            <strong>Linux:</strong> mount the share, e.g. <code>sudo mount -t cifs //nas/Movies /mnt/nas/movies -o ro,guest</code> or add it to{' '}
            <code>/etc/fstab</code>. External drives usually appear under <code>/media</code> or <code>/run/media</code>.
          </li>
        ) : null}
        <li>
          <strong>Docker:</strong> mount the folder into the container (see <code>docker-compose.yml</code>) and pick it here, e.g. <code>/media/movies</code>.
        </li>
        <li>If a drive is disconnected, your titles are kept and marked offline until it comes back.</li>
      </ul>
    </details>
  );
}

export function LibraryForm({
  library,
  onSaved,
  onCancel,
  submitLabel,
}: {
  library: LibraryDTO | null;
  onSaved: (lib: LibraryDTO) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const loadLibraries = useApp((s) => s.loadLibraries);
  const [kind, setKind] = useState<LibraryKind>(library?.kind ?? 'movies');
  const [path, setPath] = useState(library?.path ?? '');
  const [name, setName] = useState(library?.name ?? '');
  const [browsing, setBrowsing] = useState(false);
  const [check, setCheck] = useState<FsCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debouncedPath = useDebounced(path.trim(), 500);

  useEffect(() => {
    if (!debouncedPath) {
      setCheck(null);
      return;
    }
    let alive = true;
    setChecking(true);
    api
      .fsCheck(debouncedPath)
      .then((r) => alive && setCheck(r))
      .catch(() => alive && setCheck(null))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [debouncedPath]);

  const folderName = path.trim().split(/[\\/]/).filter(Boolean).pop() ?? '';

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const input = { name: name.trim() || folderName || 'Library', path: path.trim(), kind };
      const saved = library ? await api.updateLibrary(library.id, input) : await api.addLibrary(input);
      await loadLibraries();
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save library');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lib-form">
      <div className="field">
        <span className="field-label">What kind of videos are in this folder?</span>
        <div className="segmented">
          {KINDS.map((k) => (
            <button key={k.value} type="button" className={kind === k.value ? 'is-active' : ''} onClick={() => setKind(k.value)}>
              <k.icon />
              <span>
                <strong>{k.label}</strong>
                <em>{k.hint}</em>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="lib-path">Folder</label>
        <div className="lib-form__path">
          <input
            id="lib-path"
            className="input input--mono"
            placeholder="e.g. /mnt/nas/movies, D:\Movies, \\NAS\Movies, /Volumes/External/Films"
            value={path}
            spellCheck={false}
            onChange={(e) => setPath(e.target.value)}
          />
          <button type="button" className="btn btn--grey" onClick={() => setBrowsing(true)}>
            <FolderIcon /> Browse…
          </button>
        </div>
        <div className="lib-form__check" aria-live="polite">
          {checking ? (
            <span className="check check--pending">Checking folder…</span>
          ) : check?.ok ? (
            <span className="check check--ok">
              <CheckIcon /> Folder is reachable · {check.videoCount === 0 ? 'no videos found yet' : `${check.videoCount}${check.videoCount >= 400 ? '+' : ''} videos found`}
            </span>
          ) : check?.error ? (
            <span className="check check--bad">
              <WarningIcon /> {check.error}
            </span>
          ) : null}
        </div>
        <NetworkTips />
      </div>
      <div className="field">
        <label htmlFor="lib-name">Name</label>
        <input id="lib-name" className="input" placeholder={folderName || 'e.g. Movies on NAS'} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="lib-form__buttons">
        <button className="btn btn--red" disabled={saving || !path.trim()} onClick={() => void save()}>
          {saving ? 'Saving…' : (submitLabel ?? (library ? 'Save changes' : 'Add library'))}
        </button>
        {onCancel ? (
          <button className="btn btn--grey" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      {browsing ? (
        <FolderBrowser
          initial={path.trim()}
          onClose={() => setBrowsing(false)}
          onPick={(p) => {
            setPath(p);
            setBrowsing(false);
          }}
        />
      ) : null}
    </div>
  );
}
