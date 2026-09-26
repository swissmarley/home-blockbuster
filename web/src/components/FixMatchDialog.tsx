import { useEffect, useState } from 'react';
import type { MatchCandidate, TitleDetail } from '@shared/types';
import { api } from '../api/client';
import { useApp } from '../store/app';
import { CloseIcon, SearchIcon } from './Icons';
import './FixMatchDialog.css';

const PROVIDER_NAMES: Record<string, string> = { tmdb: 'TMDB', tvmaze: 'TVmaze', itunes: 'iTunes', omdb: 'OMDb' };

export function FixMatchDialog({
  detail,
  onClose,
  onMatched,
}: {
  detail: Pick<TitleDetail, 'id' | 'name' | 'year' | 'kind' | 'locked'>;
  onClose: () => void;
  onMatched: (d: TitleDetail) => void;
}) {
  const toast = useApp((s) => s.toast);
  const [query, setQuery] = useState(detail.name);
  const [year, setYear] = useState(detail.year ? String(detail.year) : '');
  const [results, setResults] = useState<MatchCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (q = query, y = year): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setResults(await api.candidates(detail.id, q.trim(), y ? Number(y) : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void search(detail.name, detail.year ? String(detail.year) : '');
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const apply = async (c: MatchCandidate): Promise<void> => {
    setApplying(`${c.provider}:${c.id}`);
    try {
      const updated = await api.match(detail.id, c.provider, c.id);
      toast(`Matched to “${updated.name}”`, 'success');
      onMatched(updated);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not apply match', 'error');
    } finally {
      setApplying(null);
    }
  };

  const reset = async (): Promise<void> => {
    setApplying('reset');
    try {
      const updated = await api.unlockTitle(detail.id);
      toast('Automatic matching restored', 'success');
      onMatched(updated);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not reset match', 'error');
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="fix-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fix" role="dialog" aria-modal="true" aria-label="Fix match">
        <header className="fix__head">
          <h2>Fix match</h2>
          <button className="fix__close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <p className="fix__hint">
          Search for the right {detail.kind === 'movie' ? 'movie' : 'show'} and pick it. Home Blockbuster will remember your choice.
        </p>
        <form
          className="fix__form"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title" aria-label="Title" autoFocus />
          <input
            className="input fix__year"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="Year"
            aria-label="Year"
            inputMode="numeric"
          />
          <button className="btn btn--red" type="submit" disabled={loading}>
            <SearchIcon /> Search
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="fix__results">
          {loading ? <div className="spinner fix__spinner" /> : null}
          {!loading && results?.length === 0 ? (
            <p className="fix__empty">
              No matches. Check the spelling, remove the year, or add a free TMDB API key in Settings for better results.
            </p>
          ) : null}
          {!loading &&
            results?.map((c) => (
              <button
                key={`${c.provider}:${c.id}`}
                className="fix__result"
                disabled={applying !== null}
                onClick={() => void apply(c)}
              >
                <span className="fix__poster">{c.poster ? <img src={c.poster} alt="" loading="lazy" /> : null}</span>
                <span className="fix__text">
                  <strong>
                    {c.name} {c.year ? <em>({c.year})</em> : null}
                  </strong>
                  <span className="fix__provider">
                    {PROVIDER_NAMES[c.provider] ?? c.provider}
                    {c.score !== undefined ? ` · ${Math.round(Math.min(1, c.score) * 100)}% similar` : ''}
                  </span>
                  {c.overview ? <span className="fix__overview">{c.overview}</span> : null}
                </span>
                {applying === `${c.provider}:${c.id}` ? <span className="spinner fix__applying" /> : null}
              </button>
            ))}
        </div>
        {detail.locked ? (
          <footer className="fix__footer">
            <button className="btn btn--grey btn--small" onClick={() => void reset()} disabled={applying !== null}>
              Undo manual match
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
