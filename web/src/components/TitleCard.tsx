import { useRef } from 'react';
import type { ContinueItem, TitleSummary } from '@shared/types';
import { isNewArrival } from '../lib/format';
import { canHover } from '../lib/hooks';
import { useApp } from '../store/app';
import { pageRect, usePreview } from './previewStore';
import { useOpenTitle, usePlay } from './titleNavigation';
import './TitleCard.css';

export type ImageKind = 'card' | 'backdrop' | 'thumb' | 'poster' | null;

/** Best 16:9 artwork for a card: title-treated card art, then backdrop, grabbed frame, poster. */
export function landscapeImage(t: TitleSummary): { src: string | null; kind: ImageKind } {
  if (t.images.card) return { src: t.images.card, kind: 'card' };
  if (t.images.backdrop) return { src: t.images.backdrop, kind: 'backdrop' };
  if (t.images.thumb) return { src: t.images.thumb, kind: 'thumb' };
  if (t.images.poster) return { src: t.images.poster, kind: 'poster' };
  return { src: null, kind: null };
}

function hue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export function fallbackBackground(id: string): string {
  const h = hue(id);
  return `radial-gradient(120% 120% at 20% 10%, hsl(${h} 45% 32%), hsl(${(h + 40) % 360} 50% 12%) 70%)`;
}

/** Title treatment drawn over artwork that has no title text of its own. */
export function TitleTreatment({ title, className = '' }: { title: TitleSummary; className?: string }) {
  if (title.images.logo) {
    return (
      <div className={`treatment treatment--logo ${className}`}>
        <img src={title.images.logo} alt={title.name} draggable={false} />
      </div>
    );
  }
  return (
    <div className={`treatment treatment--text ${className}`}>
      <span>{title.name}</span>
    </div>
  );
}

function CardArt({ title, continueItem, topTen }: { title: TitleSummary; continueItem?: ContinueItem; topTen?: boolean }) {
  const epoch = useApp((s) => s.libraryEpoch);
  const { src, kind } = landscapeImage(title);
  const hasTitleInArt = kind === 'card' && title.images.cardHasTitle;
  return (
    <div className="card__art" style={src ? undefined : { background: fallbackBackground(title.id) }}>
      {src ? <img className={`card__img card__img--${kind}`} src={src} alt="" loading="lazy" draggable={false} /> : null}
      {!hasTitleInArt ? <TitleTreatment title={title} className="card__treatment" /> : null}
      {topTen && !continueItem ? (
        <span className="badge-top10" aria-label="Top 10">
          <small>TOP</small>10
        </span>
      ) : null}
      {!continueItem && isNewArrival(title, epoch) ? <span className="badge-recent">Recently Added</span> : null}
      {continueItem ? (
        <div className="card__progress progress-bar">
          <span style={{ width: `${Math.max(2, Math.round(continueItem.progress * 100))}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function RankNumber({ rank }: { rank: number }) {
  const label = String(rank);
  return (
    <svg className="rank" viewBox="0 0 100 150" aria-hidden="true">
      <text
        x="96"
        y="138"
        textAnchor="end"
        fontSize="170"
        fontWeight="900"
        className="rank__text"
        {...(label.length > 1 ? { textLength: 108, lengthAdjust: 'spacingAndGlyphs' } : {})}
      >
        {label}
      </text>
    </svg>
  );
}

function Top10Art({ title, rank }: { title: TitleSummary; rank: number }) {
  const poster = title.images.poster ?? title.images.thumb ?? title.images.backdrop;
  return (
    <div className="card__top10">
      <RankNumber rank={rank} />
      <div className="card__poster" style={poster ? undefined : { background: fallbackBackground(title.id) }}>
        {poster ? <img src={poster} alt="" loading="lazy" draggable={false} /> : <TitleTreatment title={title} className="card__treatment" />}
      </div>
    </div>
  );
}

export function TitleCard({
  title,
  continueItem,
  rank,
  topTen,
  variant = 'standard',
}: {
  title: TitleSummary;
  continueItem?: ContinueItem;
  rank?: number;
  topTen?: boolean;
  variant?: 'standard' | 'top10';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const openPopup = usePreview((s) => s.openPopup);
  const openTitle = useOpenTitle();
  const play = usePlay();

  const onEnter = (): void => {
    if (!canHover()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!ref.current) return;
      openPopup({ title, rect: pageRect(ref.current), continueItem, key: `${title.id}:${Date.now()}` });
    }, 420);
  };
  const onLeave = (): void => window.clearTimeout(timer.current);
  const activate = (): void => {
    window.clearTimeout(timer.current);
    if (continueItem && !canHover()) play(continueItem.fileId);
    else openTitle(title.id);
  };

  return (
    <div
      ref={ref}
      className={`card card--${variant}`}
      role="button"
      tabIndex={0}
      aria-label={title.name}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
    >
      {variant === 'top10' && rank ? <Top10Art title={title} rank={rank} /> : <CardArt title={title} continueItem={continueItem} topTen={topTen} />}
    </div>
  );
}
