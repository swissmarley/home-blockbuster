import { useMemo, useState } from 'react';
import type { ThumbRating, TitleSummary } from '@shared/types';
import { lengthLabel } from '../lib/format';
import { genreAffinity, matchPercent } from '../lib/rows';
import { useApp } from '../store/app';
import { CheckIcon, DoubleThumbIcon, PlusIcon, ThumbDownIcon, ThumbUpIcon } from './Icons';
import './TitleControls.css';

export function MyListButton({ titleId, className = '' }: { titleId: string; className?: string }) {
  const inList = useApp((s) => s.profileState?.myList.includes(titleId) ?? false);
  const toggle = useApp((s) => s.toggleMyList);
  return (
    <button
      className={`circle-btn tip ${className}`}
      data-tip={inList ? 'Remove from My List' : 'Add to My List'}
      aria-label={inList ? 'Remove from My List' : 'Add to My List'}
      onClick={(e) => {
        e.stopPropagation();
        void toggle(titleId);
      }}
    >
      {inList ? <CheckIcon /> : <PlusIcon />}
    </button>
  );
}

const RATINGS: Array<{ value: ThumbRating; label: string }> = [
  { value: -1, label: 'Not for me' },
  { value: 1, label: 'I like this' },
  { value: 2, label: 'Love this!' },
];

function RatingIcon({ value, filled }: { value: ThumbRating; filled?: boolean }) {
  if (value === -1) return <ThumbDownIcon filled={filled} />;
  if (value === 2) return <DoubleThumbIcon filled={filled} />;
  return <ThumbUpIcon filled={filled} />;
}

/** Hover the thumb to reveal "Not for me / I like this / Love this!". */
export function RatingButton({ titleId, className = '' }: { titleId: string; className?: string }) {
  const rating = useApp((s) => s.profileState?.ratings[titleId]);
  const rate = useApp((s) => s.rate);
  const [open, setOpen] = useState(false);
  return (
    <div className={`rating ${open ? 'rating--open' : ''} ${className}`} onMouseLeave={() => setOpen(false)}>
      <button
        className="circle-btn"
        aria-label="Rate this title"
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <RatingIcon value={rating ?? 1} filled={rating !== undefined} />
      </button>
      {open ? (
        <div className="rating__pill" role="group" aria-label="Rate">
          {RATINGS.map((r) => (
            <button
              key={r.value}
              className={`rating__option tip ${rating === r.value ? 'is-active' : ''}`}
              data-tip={r.label}
              aria-label={r.label}
              aria-pressed={rating === r.value}
              onClick={(e) => {
                e.stopPropagation();
                void rate(titleId, rating === r.value ? 0 : r.value);
                setOpen(false);
              }}
            >
              <RatingIcon value={r.value} filled={rating === r.value} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function useMatch(title: TitleSummary): number | null {
  const titleMap = useApp((s) => s.titleMap);
  const state = useApp((s) => s.profileState);
  const affinity = useMemo(() => genreAffinity(titleMap, state), [titleMap, state]);
  return matchPercent(title, affinity);
}

export function MetaLine({ title, showYear = false, className = '' }: { title: TitleSummary; showYear?: boolean; className?: string }) {
  const match = useMatch(title);
  const length = lengthLabel(title);
  return (
    <div className={`meta-line ${className}`}>
      {match !== null ? <span className="match">{match}% Match</span> : null}
      {showYear && title.year ? <span className="meta-line__year">{title.year}</span> : null}
      {title.maturity ? <span className="maturity">{title.maturity}</span> : null}
      {length ? <span className="meta-line__length">{length}</span> : null}
      {title.quality ? <span className="hd-badge">{title.quality === '4K' ? '4K' : title.quality}</span> : null}
    </div>
  );
}

/** Up to three mood tags / genres separated by dots. */
export function moodTags(title: TitleSummary, max = 3): string[] {
  const moods = title.tags.filter((t) => t.length <= 18).slice(0, 2);
  return [...new Set([...moods, ...title.genres])].slice(0, max);
}

export function TagLine({ title, className = '' }: { title: TitleSummary; className?: string }) {
  const tags = moodTags(title);
  if (!tags.length) return null;
  return (
    <div className={`dot-list tag-line ${className}`}>
      {tags.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </div>
  );
}
