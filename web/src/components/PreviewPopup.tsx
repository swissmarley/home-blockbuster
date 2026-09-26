import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { episodeCode, progressLabel } from '../lib/format';
import { ChevronDownIcon, PlayIcon, VolumeHighIcon, VolumeOffIcon } from './Icons';
import { usePreview, type PopupTarget } from './previewStore';
import { fallbackBackground, landscapeImage, TitleTreatment } from './TitleCard';
import { MetaLine, MyListButton, RatingButton, TagLine } from './TitleControls';
import { useOpenTitle, usePlay } from './titleNavigation';
import { usePreviewVideo } from './usePreviewVideo';
import './PreviewPopup.css';

const SCALE = 1.5;

function PreviewPopup({ target, onClose }: { target: PopupTarget; onClose: () => void }) {
  const { title, rect, continueItem } = target;
  const openTitle = useOpenTitle();
  const play = usePlay();
  const [phase, setPhase] = useState<'enter' | 'open' | 'leave'>('enter');
  const closing = useRef(false);

  const vw = document.documentElement.clientWidth;
  const width = Math.min(vw - 16, Math.max(rect.width * SCALE, 300));
  const imageHeight = (width * 9) / 16;
  const edge = vw * 0.04;
  const cardLeft = rect.left - window.scrollX;
  let left = rect.left + rect.width / 2 - width / 2;
  let originX = '50%';
  if (cardLeft < edge + 12) {
    left = rect.left;
    originX = '0%';
  } else if (cardLeft + rect.width > vw - edge - 12) {
    left = rect.left + rect.width - width;
    originX = '100%';
  }
  left = Math.max(window.scrollX + 8, Math.min(left, window.scrollX + vw - width - 8));
  const top = Math.max(window.scrollY + 70, rect.top + rect.height / 2 - imageHeight / 2);
  const startScale = rect.width / width;

  const video = usePreviewVideo({
    id: `popup:${title.id}`,
    url: title.previewUrl,
    enabled: phase === 'open',
    delayMs: 900,
    maxSeconds: 60,
  });

  useEffect(() => {
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
    return () => cancelAnimationFrame(frame);
  }, []);

  const leave = (): void => {
    if (closing.current) return;
    closing.current = true;
    setPhase('leave');
    window.setTimeout(onClose, 200);
  };

  const { src, kind } = landscapeImage(title);
  const hasTitleInArt = kind === 'card' && title.images.cardHasTitle;
  const fileId = continueItem?.fileId ?? title.playFileId;

  return (
    <div
      className={`mini mini--${phase}`}
      style={{
        left,
        top,
        width,
        transformOrigin: `${originX} ${imageHeight / 2}px`,
        ['--start-scale' as string]: startScale,
      }}
      onMouseLeave={leave}
      role="dialog"
      aria-label={title.name}
    >
      <div className="mini__media" style={src ? undefined : { background: fallbackBackground(title.id) }} onClick={() => openTitle(title.id)}>
        {src ? <img className="mini__img" src={src} alt="" draggable={false} /> : null}
        {video.videoProps ? <video className={`mini__video ${video.playing ? 'is-playing' : ''}`} {...video.videoProps} /> : null}
        {!hasTitleInArt || video.playing ? <TitleTreatment title={title} className="mini__treatment" /> : null}
        {video.playing ? (
          <button
            className="circle-btn mini__mute"
            aria-label={video.muted ? 'Unmute' : 'Mute'}
            onClick={(e) => {
              e.stopPropagation();
              video.toggleMute();
            }}
          >
            {video.muted ? <VolumeOffIcon /> : <VolumeHighIcon />}
          </button>
        ) : null}
      </div>
      <div className="mini__info">
        <div className="mini__buttons">
          <button
            className="circle-btn circle-btn--play"
            aria-label="Play"
            disabled={!fileId}
            onClick={() => play(fileId)}
          >
            <PlayIcon />
          </button>
          <MyListButton titleId={title.id} />
          <RatingButton titleId={title.id} />
          <button className="circle-btn mini__more tip" data-tip="Episodes & info" aria-label="More info" onClick={() => openTitle(title.id)}>
            <ChevronDownIcon />
          </button>
        </div>
        {continueItem ? (
          <div className="mini__continue">
            <div className="progress-bar mini__progress">
              <span style={{ width: `${Math.round(continueItem.progress * 100)}%` }} />
            </div>
            <span className="mini__continue-label">{progressLabel(continueItem.position, continueItem.duration)}</span>
          </div>
        ) : null}
        {continueItem?.episode ? (
          <div className="mini__episode">
            <strong>{episodeCode(continueItem.episode)}</strong> “{continueItem.episode.name}”
          </div>
        ) : (
          <MetaLine title={title} className="mini__meta" />
        )}
        <TagLine title={title} className="mini__tags" />
      </div>
    </div>
  );
}

/** Renders the single active hover popup in a portal on top of the page. */
export function PreviewHost() {
  const popup = usePreview((s) => s.popup);
  const close = usePreview((s) => s.closePopup);
  const location = useLocation();

  useEffect(() => {
    close();
  }, [location.pathname, location.search, close]);

  useEffect(() => {
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [close]);

  if (!popup) return null;
  return createPortal(<PreviewPopup key={popup.key} target={popup} onClose={close} />, document.body);
}
