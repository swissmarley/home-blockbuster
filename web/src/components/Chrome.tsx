import { Link } from 'react-router-dom';
import { useApp } from '../store/app';
import { CloseIcon } from './Icons';
import './Chrome.css';

export function Footer() {
  const version = useApp((s) => s.system?.version);
  return (
    <footer className="footer">
      <ul className="footer__links">
        <li>
          <Link to="/settings/libraries">Media Libraries</Link>
        </li>
        <li>
          <Link to="/settings/metadata">Metadata &amp; API Keys</Link>
        </li>
        <li>
          <Link to="/settings/playback">Playback Settings</Link>
        </li>
        <li>
          <Link to="/profiles/manage">Manage Profiles</Link>
        </li>
        <li>
          <Link to="/settings/about">Help Center</Link>
        </li>
        <li>
          <Link to="/my-list">My List</Link>
        </li>
        <li>
          <Link to="/latest">New &amp; Popular</Link>
        </li>
        <li>
          <a href="https://github.com/swissmarley/home-blockbuster" target="_blank" rel="noreferrer">
            Source Code
          </a>
        </li>
      </ul>
      <p className="footer__credits">
        Metadata and artwork courtesy of TMDB, TVmaze, the iTunes Search API and OMDb. This product uses the TMDB API but is not endorsed or
        certified by TMDB.
      </p>
      <p className="footer__copy">Home Blockbuster{version ? ` v${version}` : ''} · Your media, your drives.</p>
    </footer>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`}>
          <span>{t.message}</span>
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

const PHASES: Record<string, string> = {
  discovering: 'Looking for videos',
  probing: 'Reading files',
  metadata: 'Fetching artwork & info',
  artwork: 'Creating thumbnails',
};

export function ScanIndicator() {
  const scan = useApp((s) => s.scan);
  if (!scan?.running || scan.phase === 'idle' || scan.phase === 'done') return null;
  const pct = scan.total ? Math.round((scan.processed / scan.total) * 100) : null;
  return (
    <Link to="/settings/libraries" className="scan-indicator" title={scan.current ?? undefined}>
      <span className="spinner scan-indicator__spinner" />
      <span className="scan-indicator__text">
        <strong>{PHASES[scan.phase] ?? 'Scanning'}</strong>
        <span>
          {scan.libraryName ?? 'Library'}
          {scan.total ? ` · ${scan.processed}/${scan.total}` : ''}
        </span>
      </span>
      {pct !== null ? (
        <span className="scan-indicator__bar">
          <span style={{ width: `${pct}%` }} />
        </span>
      ) : null}
    </Link>
  );
}
