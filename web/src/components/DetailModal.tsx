import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { EpisodeDTO, SeasonDTO, TitleDetail, TitleSummary } from '@shared/types';
import { api } from '../api/client';
import { episodeCode, formatBytes, formatRuntime, lengthLabel, progressLabel } from '../lib/format';
import { useBodyScrollLock, useOnClickOutside } from '../lib/hooks';
import { useApp } from '../store/app';
import { FixMatchDialog } from './FixMatchDialog';
import {
  CaretDownIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  PlayIcon,
  RefreshIcon,
  SubtitlesIcon,
  VolumeHighIcon,
  VolumeOffIcon,
} from './Icons';
import { fallbackBackground, landscapeImage, TitleTreatment } from './TitleCard';
import { moodTags, MyListButton, RatingButton, useMatch } from './TitleControls';
import { useCloseTitle, useOpenTitle, usePlay } from './titleNavigation';
import { usePreviewVideo } from './usePreviewVideo';
import './DetailModal.css';

const SOURCE_LABEL: Record<string, string> = {
  tmdb: 'The Movie Database (TMDB)',
  tvmaze: 'TVmaze',
  itunes: 'iTunes Store',
  omdb: 'OMDb',
  embedded: 'Tags embedded in the file',
  filename: 'File name only (no online match)',
};

function PeopleLinks({ names, max }: { names: string[]; max?: number }) {
  const shown = max ? names.slice(0, max) : names;
  return (
    <>
      {shown.map((name, i) => (
        <span key={name}>
          <Link to={`/search?q=${encodeURIComponent(name)}`} className="detail__link">
            {name}
          </Link>
          {i < shown.length - 1 ? ', ' : ''}
        </span>
      ))}
      {max && names.length > max ? (
        <span>
          , <em className="detail__more">more</em>
        </span>
      ) : null}
    </>
  );
}

function SeasonPicker({ seasons, value, onChange }: { seasons: SeasonDTO[]; value: number; onChange: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);
  const current = seasons.find((s) => s.number === value);
  return (
    <div className="season-picker" ref={ref}>
      <button className="season-picker__button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {current?.name ?? `Season ${value}`}
        <CaretDownIcon />
      </button>
      {open ? (
        <ul className="season-picker__menu" role="listbox">
          {seasons.map((s) => (
            <li key={s.number}>
              <button
                role="option"
                aria-selected={s.number === value}
                className={s.number === value ? 'is-active' : ''}
                onClick={() => {
                  onChange(s.number);
                  setOpen(false);
                }}
              >
                {s.name} <span>({s.episodes.length} Episode{s.episodes.length === 1 ? '' : 's'})</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EpisodeItem({ ep, fallback, current, onPlay }: { ep: EpisodeDTO; fallback: string | null; current: boolean; onPlay: () => void }) {
  const progress = useApp((s) => s.profileState?.progress[ep.fileId]);
  const image = ep.still ?? fallback;
  const pct = progress ? (progress.finished ? 1 : progress.position / (progress.duration || 1)) : 0;
  const minutes = ep.runtime ?? (ep.duration ? Math.round(ep.duration / 60) : null);
  return (
    <div
      className={`episode ${current ? 'episode--current' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => e.key === 'Enter' && onPlay()}
    >
      <div className="episode__index">{ep.season === 0 ? '•' : ep.episode}</div>
      <div className="episode__image">
        {image ? <img src={image} alt="" loading="lazy" /> : <div className="episode__placeholder" />}
        <div className="episode__play">
          <span>
            <PlayIcon />
          </span>
        </div>
        {pct > 0 ? (
          <div className="episode__progress progress-bar">
            <span style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="episode__meta">
        <div className="episode__top">
          <span className="episode__title">{ep.name}</span>
          {minutes ? <span className="episode__duration">{minutes}m</span> : null}
        </div>
        {ep.overview ? <p className="episode__synopsis">{ep.overview}</p> : null}
      </div>
    </div>
  );
}

function Episodes({ detail, initialSeason, currentFileId }: { detail: TitleDetail; initialSeason: number; currentFileId: string | null }) {
  const play = usePlay();
  const [season, setSeason] = useState(initialSeason);
  const current = detail.seasons.find((s) => s.number === season) ?? detail.seasons[0];
  if (!current) return null;
  const fallback = detail.images.backdrop ?? detail.images.thumb;
  return (
    <section className="episodes">
      <div className="episodes__head">
        <h3>Episodes</h3>
        {detail.seasons.length > 1 ? (
          <SeasonPicker seasons={detail.seasons} value={current.number} onChange={setSeason} />
        ) : (
          <span className="episodes__season-name">{current.name}</span>
        )}
      </div>
      {current.overview ? <p className="episodes__season-overview">{current.overview}</p> : null}
      <div className="episodes__list">
        {current.episodes.map((ep) => (
          <EpisodeItem key={ep.id} ep={ep} fallback={fallback} current={ep.fileId === currentFileId} onPlay={() => play(ep.fileId)} />
        ))}
      </div>
    </section>
  );
}

function SimilarCard({ title }: { title: TitleSummary }) {
  const openTitle = useOpenTitle();
  const play = usePlay();
  const match = useMatch(title);
  const { src, kind } = landscapeImage(title);
  const length = lengthLabel(title);
  return (
    <div className="similar__card" role="button" tabIndex={0} onClick={() => openTitle(title.id)} onKeyDown={(e) => e.key === 'Enter' && openTitle(title.id)}>
      <div className="similar__image" style={src ? undefined : { background: fallbackBackground(title.id) }}>
        {src ? <img src={src} alt="" loading="lazy" /> : null}
        {!(kind === 'card' && title.images.cardHasTitle) ? <TitleTreatment title={title} className="similar__treatment" /> : null}
        {length ? <span className="similar__length">{length}</span> : null}
        <button
          className="similar__play"
          aria-label={`Play ${title.name}`}
          onClick={(e) => {
            e.stopPropagation();
            play(title.playFileId);
          }}
        >
          <PlayIcon />
        </button>
      </div>
      <div className="similar__body">
        <div className="similar__row">
          <div className="similar__meta">
            {match !== null ? <span className="match">{match}% Match</span> : null}
            <span className="similar__meta-line">
              {title.maturity ? <span className="maturity">{title.maturity}</span> : null}
              {title.year ? <span>{title.year}</span> : null}
            </span>
          </div>
          <MyListButton titleId={title.id} />
        </div>
        <p className="similar__synopsis">{title.overview || 'No description available.'}</p>
      </div>
    </div>
  );
}

function MoreLikeThis({ ids }: { ids: string[] }) {
  const titleMap = useApp((s) => s.titleMap);
  const [expanded, setExpanded] = useState(false);
  const items = ids.map((id) => titleMap[id]).filter((t): t is TitleSummary => Boolean(t));
  if (!items.length) return null;
  const shown = expanded ? items : items.slice(0, 9);
  return (
    <section className="similar">
      <h3>More Like This</h3>
      <div className={`similar__grid ${!expanded && items.length > 9 ? 'similar__grid--collapsed' : ''}`}>
        {shown.map((t) => (
          <SimilarCard key={t.id} title={t} />
        ))}
      </div>
      {items.length > 9 ? (
        <div className="similar__toggle">
          <button className="circle-btn tip" data-tip={expanded ? 'Show less' : 'Show more'} onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function About({ detail }: { detail: TitleDetail }) {
  const rows: Array<[string, React.ReactNode]> = [];
  if (detail.kind === 'movie' && detail.directors.length) rows.push(['Director', <PeopleLinks names={detail.directors} />]);
  if (detail.kind === 'show' && detail.creators.length) rows.push(['Creators', <PeopleLinks names={detail.creators} />]);
  if (detail.cast.length) rows.push(['Cast', <PeopleLinks names={detail.cast.map((c) => c.name)} />]);
  if (detail.writers.length) rows.push(['Writer', <PeopleLinks names={detail.writers} />]);
  if (detail.genres.length) rows.push(['Genres', detail.genres.join(', ')]);
  if (detail.tags.length) rows.push([`This ${detail.kind === 'movie' ? 'movie' : 'show'} is`, detail.tags.slice(0, 6).join(', ')]);
  if (detail.studios.length) rows.push([detail.kind === 'show' ? 'Network' : 'Studio', detail.studios.join(', ')]);
  if (detail.maturity) rows.push(['Maturity rating', <span className="maturity">{detail.maturity}</span>]);
  if (!rows.length) return null;
  return (
    <section className="about">
      <h3>
        About <strong>{detail.name}</strong>
      </h3>
      {rows.map(([label, value]) => (
        <div key={label} className="about__row">
          <span className="detail__label">{label}:</span> {value}
        </div>
      ))}
    </section>
  );
}

function LibraryDetails({ detail, onFix, onRefresh, refreshing }: { detail: TitleDetail; onFix: () => void; onRefresh: () => void; refreshing: boolean }) {
  const [open, setOpen] = useState(false);
  const libraries = useApp((s) => s.libraries);
  const shown = detail.files.slice(0, open ? 200 : 3);
  return (
    <section className="library-details">
      <div className="library-details__head">
        <h3>Library details</h3>
        <div className="library-details__actions">
          <button className="btn btn--grey btn--small" onClick={onFix}>
            Fix match
          </button>
          <button className="btn btn--grey btn--small" onClick={onRefresh} disabled={refreshing}>
            <RefreshIcon className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh metadata'}
          </button>
        </div>
      </div>
      <p className="library-details__source">
        Metadata: {SOURCE_LABEL[detail.source] ?? detail.source}
        {detail.locked ? ' · matched manually' : ''}
        {detail.metadataStatus === 'error' ? ' · lookup failed, will retry' : ''}
      </p>
      <ul className="library-details__files">
        {shown.map((f) => (
          <li key={f.id}>
            <code>{f.path}</code>
            <span>
              {[
                libraries.find((l) => l.id === f.libraryId)?.name,
                formatBytes(f.size),
                f.width && f.height ? `${f.width}×${f.height}` : null,
                f.videoCodec?.toUpperCase(),
                f.audioCodecs.length ? f.audioCodecs.map((a) => a.toUpperCase()).join('/') : null,
                f.duration ? formatRuntime(Math.round(f.duration / 60)) : null,
                f.subtitles.length ? `${f.subtitles.length} subtitle${f.subtitles.length > 1 ? 's' : ''}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
      {detail.files.length > 3 ? (
        <button className="library-details__toggle" onClick={() => setOpen((v) => !v)}>
          {open ? 'Show fewer files' : `Show all ${detail.files.length} files`}
        </button>
      ) : null}
    </section>
  );
}

function DetailModal({ titleId }: { titleId: string }) {
  const summary = useApp((s) => s.titleMap[titleId]);
  const continueItem = useApp((s) => s.continueItems.find((c) => c.titleId === titleId));
  const toast = useApp((s) => s.toast);
  const close = useCloseTitle();
  const play = usePlay();
  const [detail, setDetail] = useState<TitleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fixing, setFixing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [entered, setEntered] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  useBodyScrollLock(true);

  useEffect(() => {
    let alive = true;
    api
      .title(titleId)
      .then((d) => alive && setDetail(d))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
    // Re-fetch when the library changes (e.g. metadata arrived or the title was re-matched).
  }, [titleId, summary]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !fixing) close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [close, fixing]);

  const title: TitleSummary | TitleDetail | undefined = detail ?? summary;
  const match = useMatch(title ?? ({ rating: null, genres: [] } as unknown as TitleSummary));
  const video = usePreviewVideo({
    id: `modal:${titleId}`,
    url: title?.previewUrl ?? null,
    enabled: Boolean(title) && !fixing,
    delayMs: 1100,
    maxSeconds: 90,
  });

  const initialSeason = useMemo(() => {
    if (!detail?.seasons.length) return 1;
    if (continueItem?.episode) return continueItem.episode.season;
    return detail.seasons[0]!.number;
  }, [detail, continueItem]);

  if (!title) {
    return (
      <div className="modal-overlay" onClick={close}>
        <div className="detail detail--empty" onClick={(e) => e.stopPropagation()}>
          {error ? <p>{error}</p> : <div className="spinner" />}
        </div>
      </div>
    );
  }

  const image = title.images.backdrop ?? title.images.card ?? title.images.thumb ?? title.images.poster;
  const imageHasTitle = !title.images.backdrop && title.images.card === image && title.images.cardHasTitle;
  const fileId = continueItem?.fileId ?? title.playFileId;
  const resume = continueItem && continueItem.position > 0;
  const length = lengthLabel(title);
  const cast = detail?.cast.map((c) => c.name) ?? title.people;
  const tags = moodTags(title, 4);

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      setDetail(await api.refreshTitle(titleId));
      toast('Metadata refreshed', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Refresh failed', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="modal-overlay" ref={scroller} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`detail ${entered ? 'detail--in' : ''}`} role="dialog" aria-modal="true" aria-label={title.name}>
        <div className="detail__hero" style={image ? undefined : { background: fallbackBackground(title.id) }}>
          {image ? <img className="detail__hero-img" src={image} alt="" /> : null}
          {video.videoProps ? <video className={`detail__hero-video ${video.playing ? 'is-playing' : ''}`} {...video.videoProps} /> : null}
          <div className="detail__hero-fade" />
          <button className="detail__close" aria-label="Close" onClick={close}>
            <CloseIcon />
          </button>
          <div className="detail__hero-info">
            {!imageHasTitle || video.playing ? <TitleTreatment title={title} className="detail__treatment" /> : null}
            <div className="detail__buttons">
              <button className="btn btn--play detail__play" disabled={!fileId} onClick={() => play(fileId)}>
                <PlayIcon />
                {resume ? 'Resume' : 'Play'}
              </button>
              <MyListButton titleId={title.id} className="detail__circle" />
              <RatingButton titleId={title.id} className="detail__circle" />
              {video.playing ? (
                <button className="circle-btn detail__circle detail__mute" aria-label={video.muted ? 'Unmute' : 'Mute'} onClick={video.toggleMute}>
                  {video.muted ? <VolumeOffIcon /> : <VolumeHighIcon />}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="detail__body">
          <div className="detail__columns">
            <div className="detail__main">
              <div className="detail__meta">
                {match !== null ? <span className="match">{match}% Match</span> : null}
                {title.year ? <span>{title.year}</span> : null}
                {length ? <span>{length}</span> : null}
                {title.quality ? <span className="hd-badge">{title.quality}</span> : null}
                {detail?.files.some((f) => f.subtitles.length) ? <SubtitlesIcon className="detail__cc" aria-label="Subtitles available" /> : null}
              </div>
              {title.maturity ? (
                <div className="detail__maturity">
                  <span className="maturity">{title.maturity}</span>
                </div>
              ) : null}
              {continueItem?.episode ? (
                <div className="detail__continue">
                  <strong>
                    {continueItem.upNext && continueItem.position < 1 ? 'Up next: ' : ''}
                    {episodeCode(continueItem.episode)} “{continueItem.episode.name}”
                  </strong>
                  {continueItem.position >= 1 ? (
                    <div className="detail__continue-bar">
                      <div className="progress-bar">
                        <span style={{ width: `${Math.round(continueItem.progress * 100)}%` }} />
                      </div>
                      <span>{progressLabel(continueItem.position, continueItem.duration)}</span>
                    </div>
                  ) : null}
                </div>
              ) : continueItem && !continueItem.episode ? (
                <div className="detail__continue">
                  <div className="detail__continue-bar">
                    <div className="progress-bar">
                      <span style={{ width: `${Math.round(continueItem.progress * 100)}%` }} />
                    </div>
                    <span>{progressLabel(continueItem.position, continueItem.duration)}</span>
                  </div>
                </div>
              ) : null}
              {detail?.tagline ? <p className="detail__tagline">{detail.tagline}</p> : null}
              <p className="detail__overview">{title.overview || 'No description available yet.'}</p>
            </div>
            <div className="detail__side">
              {cast.length ? (
                <div>
                  <span className="detail__label">Cast: </span>
                  <PeopleLinks names={cast} max={4} />
                </div>
              ) : null}
              {title.genres.length ? (
                <div>
                  <span className="detail__label">Genres: </span>
                  {title.genres.join(', ')}
                </div>
              ) : null}
              {tags.length ? (
                <div>
                  <span className="detail__label">This {title.kind === 'movie' ? 'movie' : 'show'} is: </span>
                  {tags.join(', ')}
                </div>
              ) : null}
            </div>
          </div>

          {detail && detail.kind === 'show' && detail.seasons.length ? (
            <Episodes key={detail.id} detail={detail} initialSeason={initialSeason} currentFileId={continueItem?.fileId ?? null} />
          ) : null}
          {detail ? <MoreLikeThis ids={detail.similar} /> : null}
          {detail ? <About detail={detail} /> : null}
          {detail ? (
            <LibraryDetails detail={detail} onFix={() => setFixing(true)} onRefresh={() => void refresh()} refreshing={refreshing} />
          ) : null}
        </div>
      </div>
      {fixing && detail ? (
        <FixMatchDialog
          detail={detail}
          onClose={() => setFixing(false)}
          onMatched={(d) => {
            setFixing(false);
            setDetail(d);
          }}
        />
      ) : null}
    </div>
  );
}

/** Mount point for the detail modal, driven by the `jbv` query parameter. */
export function DetailModalHost() {
  const [params] = useSearchParams();
  const id = params.get('jbv');
  return id ? <DetailModal key={id} titleId={id} /> : null;
}
