import type { TitleSummary } from '@shared/types';
import { truncate } from '../lib/format';
import { useInView } from '../lib/hooks';
import { useApp } from '../store/app';
import { InfoIcon, PlayIcon, ReplayIcon, VolumeHighIcon, VolumeOffIcon } from './Icons';
import { fallbackBackground } from './TitleCard';
import { useOpenTitle, usePlay } from './titleNavigation';
import { usePreviewVideo } from './usePreviewVideo';
import './Billboard.css';

export function Billboard({ title }: { title: TitleSummary }) {
  const openTitle = useOpenTitle();
  const play = usePlay();
  const [ref, inView] = useInView<HTMLElement>(0.35);
  const continueItem = useApp((s) => s.continueItems.find((c) => c.titleId === title.id));
  const image = title.images.backdrop ?? title.images.thumb ?? title.images.card ?? title.images.poster;
  const video = usePreviewVideo({
    id: `billboard:${title.id}`,
    url: title.previewUrl,
    enabled: inView,
    delayMs: 2500,
    maxSeconds: 50,
  });
  const fileId = continueItem?.fileId ?? title.playFileId;

  return (
    <section ref={ref} className={`billboard ${video.playing ? 'billboard--playing' : ''}`} aria-label={`Featured: ${title.name}`}>
      <div className="billboard__media" style={image ? undefined : { background: fallbackBackground(title.id) }}>
        {image ? (
          <img
            className={`billboard__image ${image === title.images.poster ? 'billboard__image--poster' : ''}`}
            src={image}
            alt=""
            draggable={false}
          />
        ) : null}
        {video.videoProps ? <video className={`billboard__video ${video.playing ? 'is-playing' : ''}`} {...video.videoProps} /> : null}
        <div className="billboard__vignette" />
        <div className="billboard__fade" />
      </div>

      <div className="billboard__info">
        <div className="billboard__title">
          {title.images.logo ? (
            <img className="billboard__logo" src={title.images.logo} alt={title.name} draggable={false} />
          ) : (
            <h1 className="billboard__name">{title.name}</h1>
          )}
        </div>
        {title.overview ? <p className="billboard__synopsis">{truncate(title.overview, 220)}</p> : null}
        <div className="billboard__buttons">
          <button className="btn btn--play billboard__btn" disabled={!fileId} onClick={() => play(fileId)}>
            <PlayIcon />
            {continueItem && continueItem.position > 0 ? 'Resume' : 'Play'}
          </button>
          <button className="btn btn--grey billboard__btn" onClick={() => openTitle(title.id)}>
            <InfoIcon />
            More Info
          </button>
        </div>
      </div>

      <div className="billboard__side">
        {video.playing ? (
          <button className="billboard__round" aria-label={video.muted ? 'Unmute' : 'Mute'} onClick={video.toggleMute}>
            {video.muted ? <VolumeOffIcon /> : <VolumeHighIcon />}
          </button>
        ) : video.finished && title.previewUrl ? (
          <button className="billboard__round" aria-label="Replay preview" onClick={video.replay}>
            <ReplayIcon />
          </button>
        ) : null}
        {title.maturity ? <span className="billboard__maturity">{title.maturity}</span> : null}
      </div>
    </section>
  );
}
