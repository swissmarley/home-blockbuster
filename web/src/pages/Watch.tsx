import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { PlaybackInfo, SubtitleCue, TitleDetail } from '@shared/types';
import { api } from '../api/client';
import {
  BackIcon,
  CheckIcon,
  EpisodesIcon,
  ExitFullscreenIcon,
  Forward10Icon,
  FullscreenIcon,
  NextEpisodeIcon,
  PauseIcon,
  PlayIcon,
  Rewind10Icon,
  SpeedIcon,
  SubtitlesIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeOffIcon,
  WarningIcon,
} from '../components/Icons';
import { browserCaps } from '../lib/caps';
import { formatClock } from '../lib/format';
import { readLocal, writeLocal } from '../lib/storage';
import { useApp, useCurrentProfile } from '../store/app';
import './Watch.css';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];
const HIDE_AFTER_MS = 3200;

type Panel = null | 'episodes' | 'subtitles' | 'speed';
type Flash = { kind: 'play' | 'pause' | 'back' | 'forward'; id: number } | null;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Render subtitle text with the few tags we allow (<i>, <b>, <u>) as React nodes. */
function renderCueText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const state = { i: false, b: false, u: false };
  let key = 0;
  for (const part of text.split(/(<\/?[ibu]>)/i)) {
    const tag = /^<(\/?)([ibu])>$/i.exec(part);
    if (tag) {
      state[tag[2]!.toLowerCase() as 'i' | 'b' | 'u'] = tag[1] !== '/';
      continue;
    }
    if (!part) continue;
    const lines = part.split('\n');
    lines.forEach((line, idx) => {
      if (idx > 0) out.push(<br key={`br${key++}`} />);
      if (!line) return;
      out.push(
        <span
          key={`t${key++}`}
          style={{
            fontStyle: state.i ? 'italic' : undefined,
            fontWeight: state.b ? 800 : undefined,
            textDecoration: state.u ? 'underline' : undefined,
          }}
        >
          {line}
        </span>,
      );
    });
  }
  return out;
}

function activeCues(cues: SubtitleCue[], t: number): SubtitleCue[] {
  // Binary search for the last cue starting before t, then look back for overlaps.
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]!.start <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const out: SubtitleCue[] = [];
  for (let i = idx; i >= 0 && i > idx - 8; i--) {
    const c = cues[i]!;
    if (c.start <= t && c.end >= t) out.unshift(c);
  }
  return out;
}

function Scrubber({
  time,
  duration,
  buffered,
  fileId,
  frames,
  onSeek,
  onScrub,
}: {
  time: number;
  duration: number;
  buffered: number;
  fileId: string;
  frames: boolean;
  onSeek: (t: number) => void;
  onScrub: (t: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [frameT, setFrameT] = useState<number | null>(null);

  const posToTime = (clientX: number): number => {
    const rect = ref.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  };

  useEffect(() => {
    if (!frames || hover === null) return;
    const snapped = Math.round(hover / 10) * 10;
    const t = window.setTimeout(() => setFrameT(snapped), 90);
    return () => window.clearTimeout(t);
  }, [hover, frames]);

  const shown = drag ?? time;
  const pct = duration ? (shown / duration) * 100 : 0;
  const hoverPct = hover !== null && duration ? (hover / duration) * 100 : null;
  const bufferPct = duration ? clamp((buffered / duration) * 100, 0, 100) : 0;

  return (
    <div
      ref={ref}
      className={`scrubber ${drag !== null ? 'scrubber--dragging' : ''}`}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      onPointerDown={(e) => {
        if (!duration) return;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        const t = posToTime(e.clientX);
        setDrag(t);
        onScrub(t);
      }}
      onPointerMove={(e) => {
        if (!duration) return;
        const t = posToTime(e.clientX);
        setHover(t);
        if (drag !== null) {
          setDrag(t);
          onScrub(t);
        }
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        const t = posToTime(e.clientX);
        setDrag(null);
        onScrub(null);
        onSeek(t);
      }}
      onPointerLeave={() => {
        if (drag === null) setHover(null);
      }}
    >
      <div className="scrubber__track">
        <div className="scrubber__buffer" style={{ width: `${bufferPct}%` }} />
        {hoverPct !== null && hoverPct > pct ? <div className="scrubber__hover" style={{ width: `${hoverPct}%` }} /> : null}
        <div className="scrubber__played" style={{ width: `${pct}%` }} />
      </div>
      <div className="scrubber__knob" style={{ left: `${pct}%` }} />
      {hover !== null || drag !== null ? (
        <div className="scrubber__tooltip" style={{ left: `clamp(90px, ${((drag ?? hover)! / (duration || 1)) * 100}%, calc(100% - 90px))` }}>
          {frames && frameT !== null ? (
            <img className="scrubber__frame" src={`/api/files/${fileId}/frame?t=${frameT}`} alt="" draggable={false} />
          ) : null}
          <span>{formatClock((drag ?? hover)!)}</span>
        </div>
      ) : null}
    </div>
  );
}

function VolumeControl({ volume, muted, onChange, onToggle }: { volume: number; muted: boolean; onChange: (v: number) => void; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const setFromY = (clientY: number): void => {
    const rect = track.current!.getBoundingClientRect();
    onChange(clamp(1 - (clientY - rect.top) / rect.height, 0, 1));
  };
  const level = muted ? 0 : volume;
  return (
    <div className="volume" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {open ? (
        <div className="volume__panel">
          <div
            ref={track}
            className="volume__track"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              setFromY(e.clientY);
            }}
            onPointerMove={(e) => {
              if (e.buttons & 1) setFromY(e.clientY);
            }}
          >
            <div className="volume__fill" style={{ height: `${level * 100}%` }} />
            <div className="volume__knob" style={{ bottom: `${level * 100}%` }} />
          </div>
        </div>
      ) : null}
      <button className="player__btn" aria-label={muted ? 'Unmute' : 'Mute'} onClick={onToggle}>
        {level === 0 ? <VolumeOffIcon /> : level < 0.5 ? <VolumeLowIcon /> : <VolumeHighIcon />}
      </button>
    </div>
  );
}

function EpisodesPanel({ info, onPick }: { info: PlaybackInfo; onPick: (fileId: string) => void }) {
  const [detail, setDetail] = useState<TitleDetail | null>(null);
  const [season, setSeason] = useState<number | null>(info.episode?.season ?? null);
  const progress = useApp((s) => s.profileState?.progress);
  useEffect(() => {
    api.title(info.titleId).then(setDetail).catch(() => undefined);
  }, [info.titleId]);
  if (!detail) return <div className="panel panel--episodes"><div className="spinner panel__spinner" /></div>;
  const current = detail.seasons.find((s) => s.number === season);
  return (
    <div className="panel panel--episodes" onClick={(e) => e.stopPropagation()}>
      {current ? (
        <>
          <button className="panel__head panel__head--back" onClick={() => setSeason(null)}>
            <BackIcon /> {current.name}
          </button>
          <ul className="panel__episodes">
            {current.episodes.map((ep) => {
              const p = progress?.[ep.fileId];
              const pct = p ? (p.finished ? 100 : (p.position / (p.duration || 1)) * 100) : 0;
              const isCurrent = ep.fileId === info.fileId;
              return (
                <li key={ep.id} className={isCurrent ? 'is-current' : ''}>
                  <button onClick={() => !isCurrent && onPick(ep.fileId)}>
                    <span className="panel__ep-num">{ep.episode}</span>
                    <span className="panel__ep-name">{ep.name}</span>
                    {pct > 0 ? (
                      <span className="panel__ep-progress progress-bar">
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    ) : null}
                  </button>
                  {isCurrent ? (
                    <div className="panel__ep-detail">
                      {ep.still ? <img src={ep.still} alt="" /> : null}
                      <p>{ep.overview}</p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <>
          <div className="panel__head">{detail.name}</div>
          <ul className="panel__seasons">
            {detail.seasons.map((s) => (
              <li key={s.number}>
                <button onClick={() => setSeason(s.number)}>
                  {s.name}
                  <span>{s.episodes.length} episodes</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function Watch() {
  const { fileId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useCurrentProfile();
  const loadProfiles = useApp((s) => s.loadProfiles);
  const refreshProfileData = useApp((s) => s.refreshProfileData);
  const setActivePreview = useApp((s) => s.setActivePreview);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const pendingSeek = useRef(0);
  const timeRef = useRef(0);
  const durationRef = useRef(0);
  const seekTimer = useRef(0);
  const hideTimer = useRef(0);
  const flashSeq = useRef(0);
  const session = useMemo(() => Math.random().toString(36).slice(2, 10), []);

  const [info, setInfo] = useState<PlaybackInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(() => clamp(Number(readLocal('hb.volume') ?? 1), 0, 1));
  const [muted, setMuted] = useState(false);
  const [controls, setControls] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [subtitleId, setSubtitleId] = useState<string | null>(null);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [pausedLong, setPausedLong] = useState(false);
  const [nextDismissed, setNextDismissed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [fallbackTried, setFallbackTried] = useState(false);

  const videoDuration = videoRef.current && Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : 0;
  const duration = info?.mode === 'direct' ? videoDuration || info?.duration || 0 : info?.duration || videoDuration || 0;
  durationRef.current = duration;

  useEffect(() => {
    setActivePreview('player');
    return () => setActivePreview(null);
  }, [setActivePreview]);

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  const start = useCallback(
    async (i: PlaybackInfo, at: number) => {
      setWaiting(true);
      if (i.mode === 'direct') {
        offsetRef.current = 0;
        pendingSeek.current = at;
        setSrc(i.url);
        return;
      }
      let begin = at;
      if (i.mode === 'remux' && at > 0) {
        try {
          begin = (await api.keyframe(i.fileId, at)).t;
        } catch {
          begin = at;
        }
      }
      offsetRef.current = begin;
      pendingSeek.current = 0;
      timeRef.current = begin;
      setTime(begin);
      setSrc(`${i.url}&start=${begin.toFixed(2)}&session=${session}`);
    },
    [session],
  );

  const loadInfo = useCallback(
    async (opts: { audio?: number | null; force?: boolean; at?: number }) => {
      try {
        const i = await api.playback(fileId, {
          profileId: profile?.id,
          caps: browserCaps(),
          audio: opts.audio ?? null,
          force: opts.force,
        });
        setInfo(i);
        setError(null);
        const requested = params.get('t');
        const at = opts.at ?? (requested !== null ? Number(requested) || 0 : i.resumeAt);
        await start(i, at);
        return i;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load this video');
        return null;
      }
    },
    // `t` from the URL only matters for the first load.
    [fileId, profile?.id, start],
  );

  useEffect(() => {
    void loadInfo({});
  }, [loadInfo]);

  // Pick the profile's preferred subtitles once info arrives.
  useEffect(() => {
    if (!info || !profile?.subtitleLang || subtitleId) return;
    const pref = profile.subtitleLang;
    if (pref === 'off') return;
    const track = info.subtitles.find((s) => !s.forced && (s.language === pref || s.label === pref));
    if (track) void selectSubtitle(track.id, false);
  }, [info?.fileId]);

  // Release the network stream (and the server-side ffmpeg process) on exit.
  useEffect(
    () => () => {
      const v = videoRef.current;
      if (v) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Progress reporting
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!info || !profile) return;
    const report = (keepalive = false): void => {
      const pos = timeRef.current;
      if (pos < 1 || !durationRef.current) return;
      api.progress(profile.id, info.fileId, pos, durationRef.current, keepalive).catch(() => undefined);
    };
    const interval = window.setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) report();
    }, 10_000);
    const onHide = (): void => report(true);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('pagehide', onHide);
      report(true);
      window.setTimeout(() => void refreshProfileData(), 300);
    };
  }, [info, profile, refreshProfileData]);

  // ---------------------------------------------------------------------------
  // Controls visibility
  // ---------------------------------------------------------------------------

  const poke = useCallback(() => {
    setControls(true);
    setPausedLong(false);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControls(false);
    }, HIDE_AFTER_MS);
  }, []);

  useEffect(() => {
    if (playing && !panel) poke();
    if (!playing) {
      setControls(true);
      window.clearTimeout(hideTimer.current);
    }
  }, [playing, panel, poke]);

  useEffect(() => {
    if (playing || error || waiting) {
      setPausedLong(false);
      return;
    }
    const t = window.setTimeout(() => setPausedLong(true), 7000);
    return () => window.clearTimeout(t);
  }, [playing, error, waiting, controls]);

  useEffect(() => {
    const onChange = (): void => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const showFlash = (kind: NonNullable<Flash>['kind']): void => setFlash({ kind, id: ++flashSeq.current });

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => undefined);
      showFlash('play');
    } else {
      v.pause();
      showFlash('pause');
    }
  }, []);

  const seek = useCallback(
    (target: number) => {
      const v = videoRef.current;
      if (!v || !info) return;
      const dur = durationRef.current;
      const t = clamp(target, 0, dur ? dur - 0.5 : target);
      timeRef.current = t;
      setTime(t);
      if (info.mode === 'direct') {
        v.currentTime = t;
        return;
      }
      // Within what the current stream already buffered: seek locally.
      const local = t - offsetRef.current;
      for (let i = 0; i < v.buffered.length; i++) {
        if (local >= v.buffered.start(i) && local <= v.buffered.end(i) - 0.5) {
          v.currentTime = local;
          return;
        }
      }
      // Otherwise restart the server stream at the new position (debounced for key repeats).
      setWaiting(true);
      window.clearTimeout(seekTimer.current);
      seekTimer.current = window.setTimeout(() => void start(info, t), 350);
    },
    [info, start],
  );

  const skip = useCallback(
    (delta: number) => {
      seek(timeRef.current + delta);
      showFlash(delta < 0 ? 'back' : 'forward');
    },
    [seek],
  );

  const changeVolume = useCallback((v: number) => {
    const value = clamp(v, 0, 1);
    setVolume(value);
    setMuted(value === 0);
    writeLocal('hb.volume', String(value));
  }, []);

  const toggleMute = useCallback(() => {
    if (muted || volume === 0) {
      setMuted(false);
      if (volume === 0) changeVolume(0.5);
    } else {
      setMuted(true);
    }
  }, [muted, volume, changeVolume]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
    else (videoRef.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
  }, []);

  const exit = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    if (location.key !== 'default') navigate(-1);
    else navigate(info ? `/browse?jbv=${info.titleId}` : '/browse', { replace: true });
  }, [navigate, location.key, info]);

  const goTo = useCallback(
    (nextFileId: string) => {
      navigate(`/watch/${nextFileId}`, { replace: true });
    },
    [navigate],
  );

  const selectSubtitle = async (id: string | null, remember = true): Promise<void> => {
    setSubtitleId(id);
    setCues([]);
    if (remember && profile) {
      const track = info?.subtitles.find((s) => s.id === id);
      api
        .updateProfile(profile.id, { subtitleLang: id ? (track?.language ?? track?.label ?? null) : 'off' })
        .then(() => loadProfiles())
        .catch(() => undefined);
    }
    if (!id) return;
    try {
      const res = await api.subtitles(fileId, id);
      setCues(res.cues);
    } catch (err) {
      useApp.getState().toast(err instanceof Error ? err.message : 'Could not load subtitles', 'error');
      setSubtitleId(null);
    }
  };

  const selectAudio = async (index: number): Promise<void> => {
    if (!info || index === audioIndex) return;
    setAudioIndex(index);
    const at = timeRef.current;
    await loadInfo({ audio: index, at });
  };

  // Keyboard shortcuts, like the real player.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return;
      poke();
      switch (e.key) {
        case ' ':
        case 'k':
        case 'Enter':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          skip(-10);
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          skip(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(volume - 0.1);
          break;
        case 'f':
          toggleFullscreen();
          break;
        case 'm':
          toggleMute();
          break;
        case 'N':
          if (info?.next) goTo(info.next.fileId);
          break;
        case 'Escape':
          if (panel) setPanel(null);
          else if (!document.fullscreenElement) exit();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [poke, togglePlay, skip, changeVolume, toggleMute, volume, toggleFullscreen, info, goTo, panel, exit]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = volume;
    v.muted = muted;
  }, [volume, muted, src]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed, src]);

  // ---------------------------------------------------------------------------
  // Next episode
  // ---------------------------------------------------------------------------

  const remaining = duration ? duration - time : Infinity;
  const creditsAt = duration ? clamp(duration * 0.035, 20, 60) : 0;
  const showNext = Boolean(info?.next && duration > 60 && remaining <= creditsAt && !nextDismissed && !error);

  useEffect(() => {
    if (!showNext || !profile?.autoplayNext || !playing) {
      setCountdown(null);
      return;
    }
    setCountdown(10);
    const t = window.setInterval(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [showNext, profile?.autoplayNext, playing]);

  useEffect(() => {
    if (countdown !== null && countdown <= 0 && info?.next) goTo(info.next.fileId);
  }, [countdown, info, goTo]);

  // ---------------------------------------------------------------------------
  // Video events
  // ---------------------------------------------------------------------------

  const onTimeUpdate = (): void => {
    const v = videoRef.current;
    if (!v || !info) return;
    const logical = offsetRef.current + v.currentTime;
    timeRef.current = logical;
    setTime(logical);
    if (v.buffered.length) setBuffered(offsetRef.current + v.buffered.end(v.buffered.length - 1));
  };

  const onLoadedMetadata = (): void => {
    const v = videoRef.current;
    if (!v) return;
    if (pendingSeek.current > 0) {
      v.currentTime = pendingSeek.current;
      pendingSeek.current = 0;
    }
    void v.play().catch(() => {
      setPlaying(false);
      setWaiting(false);
    });
  };

  const onVideoError = (): void => {
    const code = videoRef.current?.error?.code;
    if (!info || code === undefined) return;
    if (info.mode === 'direct' && info.canTranscode && !fallbackTried) {
      setFallbackTried(true);
      void loadInfo({ force: true, audio: audioIndex, at: timeRef.current });
      return;
    }
    setError(
      info.canTranscode
        ? `This video could not be played (error ${code}).`
        : `Your browser can't play this file format (error ${code}). Install ffmpeg on the server to enable transcoding.`,
    );
  };

  const onEnded = (): void => {
    if (info?.next && profile?.autoplayNext !== false) goTo(info.next.fileId);
    else exit();
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const subtitleCues = useMemo(() => (subtitleId ? activeCues(cues, time) : []), [cues, time, subtitleId]);
  const episode = info?.episode ?? null;
  const titleName = info?.title.name ?? '';
  const shownTime = scrubTime ?? time;

  return (
    <div
      ref={containerRef}
      className={`player ${controls || !playing ? 'player--controls' : 'player--idle'}`}
      onMouseMove={poke}
      onTouchStart={poke}
    >
      <video
        ref={videoRef}
        className="player__video"
        src={src ?? undefined}
        playsInline
        preload="auto"
        onClick={() => {
          if (panel) setPanel(null);
          else togglePlay();
        }}
        onDoubleClick={toggleFullscreen}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          if (info && profile && timeRef.current > 1) {
            api.progress(profile.id, info.fileId, timeRef.current, durationRef.current).catch(() => undefined);
          }
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onSeeked={() => setWaiting(false)}
        onEnded={onEnded}
        onError={onVideoError}
      />

      {subtitleCues.length ? (
        <div className={`player__subs ${controls ? 'player__subs--raised' : ''}`} aria-live="off">
          {subtitleCues.map((c, i) => (
            <p key={`${c.start}-${i}`}>{renderCueText(c.text)}</p>
          ))}
        </div>
      ) : null}

      {waiting && !error ? <div className="spinner player__spinner" /> : null}

      {flash ? (
        <div key={flash.id} className={`player__flash player__flash--${flash.kind}`} aria-hidden="true">
          {flash.kind === 'play' ? <PlayIcon /> : flash.kind === 'pause' ? <PauseIcon /> : flash.kind === 'back' ? <Rewind10Icon /> : <Forward10Icon />}
        </div>
      ) : null}

      {pausedLong && info ? (
        <div className="player__paused" onClick={togglePlay}>
          <div className="player__paused-info">
            <span className="player__paused-label">You&apos;re watching</span>
            <h1>{titleName}</h1>
            {episode ? (
              <h2>
                {episode.season ? `Season ${episode.season}: ` : ''}Ep. {episode.episode} “{episode.name}”
              </h2>
            ) : null}
            <p>{episode?.overview || info.title.overview}</p>
          </div>
          <span className="player__paused-hint">Paused</span>
        </div>
      ) : null}

      {error ? (
        <div className="player__error">
          <WarningIcon className="player__error-icon" />
          <h2>Whoops, something went wrong…</h2>
          <p>{error}</p>
          {info?.reason ? <p className="player__error-reason">{info.reason}</p> : null}
          <div className="player__error-buttons">
            <button
              className="btn btn--play"
              onClick={() => {
                setError(null);
                setFallbackTried(false);
                void loadInfo({ force: fallbackTried, audio: audioIndex, at: timeRef.current });
              }}
            >
              Try Again
            </button>
            <button className="btn btn--grey" onClick={exit}>
              Back to Browse
            </button>
          </div>
        </div>
      ) : null}

      {showNext && info?.next ? (
        <div className="player__next">
          <button className="btn btn--grey player__credits" onClick={() => setNextDismissed(true)}>
            Watch Credits
          </button>
          <button className="btn btn--play player__next-btn" onClick={() => goTo(info.next!.fileId)}>
            {countdown !== null ? <span className="player__next-fill" style={{ animationDuration: '10s' }} /> : null}
            <NextEpisodeIcon /> Next Episode
          </button>
        </div>
      ) : null}

      <div className="player__chrome">
        <div className="player__top">
          <button className="player__btn player__back" aria-label="Back to browse" onClick={exit}>
            <BackIcon />
          </button>
        </div>

        <div className="player__bottom" onClick={(e) => e.stopPropagation()}>
          <div className="player__timeline">
            <Scrubber
              time={time}
              duration={duration}
              buffered={buffered}
              fileId={fileId}
              frames={Boolean(info?.hasFrames)}
              onSeek={seek}
              onScrub={setScrubTime}
            />
            <span className="player__remaining">{formatClock(Math.max(0, duration - shownTime))}</span>
          </div>
          <div className="player__row">
            <button className="player__btn" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button className="player__btn" aria-label="Back 10 seconds" onClick={() => skip(-10)}>
              <Rewind10Icon />
            </button>
            <button className="player__btn" aria-label="Forward 10 seconds" onClick={() => skip(10)}>
              <Forward10Icon />
            </button>
            <VolumeControl volume={volume} muted={muted} onChange={changeVolume} onToggle={toggleMute} />

            <div className="player__title">
              {episode ? (
                <>
                  <strong>{titleName}</strong>
                  <span className="player__title-ep">{episode.season ? `E${episode.episode}` : `Special ${episode.episode}`}</span>
                  <span className="player__title-name">{episode.name}</span>
                </>
              ) : (
                <strong>{titleName}</strong>
              )}
            </div>

            {info?.next ? (
              <button className="player__btn" aria-label="Next episode" onClick={() => goTo(info.next!.fileId)}>
                <NextEpisodeIcon />
              </button>
            ) : null}
            {episode ? (
              <div className="player__popover">
                <button className="player__btn" aria-label="Episodes" onClick={() => setPanel(panel === 'episodes' ? null : 'episodes')}>
                  <EpisodesIcon />
                </button>
                {panel === 'episodes' && info ? <EpisodesPanel info={info} onPick={goTo} /> : null}
              </div>
            ) : null}
            <div className="player__popover">
              <button className="player__btn" aria-label="Audio & Subtitles" onClick={() => setPanel(panel === 'subtitles' ? null : 'subtitles')}>
                <SubtitlesIcon />
              </button>
              {panel === 'subtitles' && info ? (
                <div className="panel panel--subtitles">
                  <div className="panel__col">
                    <h3>Audio</h3>
                    <ul>
                      {info.audioTracks.length === 0 ? <li className="panel__muted">No audio</li> : null}
                      {info.audioTracks.map((a) => {
                        const active = (audioIndex ?? info.audioTracks.find((t) => t.default)?.index ?? 0) === a.index;
                        return (
                          <li key={a.index}>
                            <button className={active ? 'is-active' : ''} onClick={() => void selectAudio(a.index)}>
                              {active ? <CheckIcon /> : <span className="panel__check" />}
                              {a.label}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="panel__col">
                    <h3>Subtitles</h3>
                    <ul>
                      <li>
                        <button className={!subtitleId ? 'is-active' : ''} onClick={() => void selectSubtitle(null)}>
                          {!subtitleId ? <CheckIcon /> : <span className="panel__check" />}
                          Off
                        </button>
                      </li>
                      {info.subtitles.map((s) => (
                        <li key={s.id}>
                          <button className={subtitleId === s.id ? 'is-active' : ''} onClick={() => void selectSubtitle(s.id)}>
                            {subtitleId === s.id ? <CheckIcon /> : <span className="panel__check" />}
                            {s.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="player__popover">
              <button className="player__btn" aria-label="Playback speed" onClick={() => setPanel(panel === 'speed' ? null : 'speed')}>
                <SpeedIcon />
              </button>
              {panel === 'speed' ? (
                <div className="panel panel--speed">
                  <h3>Playback Speed</h3>
                  <div className="speed">
                    <div className="speed__line" />
                    {SPEEDS.map((s) => (
                      <button key={s} className={`speed__stop ${s === speed ? 'is-active' : ''}`} onClick={() => setSpeed(s)}>
                        <span className="speed__dot" />
                        <span className="speed__label">{s === 1 ? '1x (Normal)' : `${s}x`}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <button className="player__btn" aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen}>
              {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Remount the player for every file so no state leaks between episodes. */
export function WatchRoute() {
  const { fileId } = useParams();
  return <Watch key={fileId} />;
}
