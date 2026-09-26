import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp, useCurrentProfile } from '../store/app';
import { usePreview } from './previewStore';

export interface PreviewVideo {
  /** Render the <video> element. */
  mounted: boolean;
  /** Video is actually playing (fade it in over the artwork). */
  playing: boolean;
  /** Preview ran to its end (show a replay button). */
  finished: boolean;
  /** The browser could not play the preview. */
  failed: boolean;
  muted: boolean;
  toggleMute(): void;
  replay(): void;
  videoProps: {
    ref: React.RefObject<HTMLVideoElement | null>;
    src: string;
    muted: boolean;
    playsInline: true;
    autoPlay: true;
    preload: 'auto';
    onPlaying(): void;
    onEnded(): void;
    onError(): void;
  } | null;
}

function surfacePriority(id: string): number {
  if (id.startsWith('modal')) return 3;
  if (id.startsWith('popup')) return 2;
  return 1;
}

/**
 * Netflix-style muted preview: starts after a delay, plays for a while, then fades back to the artwork.
 * Only one surface (billboard, hover card, modal) plays at a time.
 */
export function usePreviewVideo(opts: {
  id: string;
  url: string | null;
  enabled: boolean;
  delayMs: number;
  maxSeconds?: number;
}): PreviewVideo {
  const profile = useCurrentProfile();
  const active = useApp((s) => s.activePreview);
  const setActive = useApp((s) => s.setActivePreview);
  const muted = usePreview((s) => s.muted);
  const setMuted = usePreview((s) => s.setMuted);
  const ref = useRef<HTMLVideoElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const allowed = Boolean(opts.enabled && opts.url && profile?.autoplayPreviews !== false);
  // Modal > hover card > billboard: a higher-priority surface takes the preview slot over.
  const blocked = active !== null && active !== opts.id && surfacePriority(active) >= surfacePriority(opts.id);

  useEffect(() => {
    if (!allowed || finished || failed || blocked) {
      setMounted(false);
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setActive(opts.id);
      setMounted(true);
    }, opts.delayMs);
    return () => window.clearTimeout(timer);
  }, [allowed, finished, failed, blocked, opts.delayMs, opts.id, setActive, attempt]);

  // Release the preview slot when unmounting / disabling.
  useEffect(() => {
    if (mounted) return;
    if (useApp.getState().activePreview === opts.id) setActive(null);
  }, [mounted, opts.id, setActive]);
  useEffect(
    () => () => {
      if (useApp.getState().activePreview === opts.id) setActive(null);
    },
    [opts.id, setActive],
  );

  // Stop after maxSeconds of playback.
  useEffect(() => {
    if (!playing || !opts.maxSeconds) return;
    const timer = window.setTimeout(() => {
      setFinished(true);
      setPlaying(false);
    }, opts.maxSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, opts.maxSeconds]);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted, mounted]);

  const end = useCallback(() => {
    setPlaying(false);
    setFinished(true);
  }, []);

  const onPlaying = useCallback(() => setPlaying(true), []);
  const onError = useCallback(() => {
    setPlaying(false);
    setMounted(false);
    setFailed(true);
  }, []);

  // Autoplay with sound can be refused by the browser: retry muted.
  useEffect(() => {
    const video = ref.current;
    if (!mounted || !video) return;
    video.play().catch(() => {
      video.muted = true;
      setMuted(true);
      video.play().catch(() => undefined);
    });
  }, [mounted, setMuted]);

  return {
    mounted: mounted && !finished && !failed,
    playing: playing && !finished && !failed,
    finished,
    failed,
    muted,
    toggleMute: () => setMuted(!muted),
    replay: () => {
      setFinished(false);
      setAttempt((a) => a + 1);
    },
    videoProps:
      mounted && !finished && !failed && opts.url
        ? {
            ref,
            src: opts.url,
            muted,
            playsInline: true,
            autoPlay: true,
            preload: 'auto',
            onPlaying,
            onEnded: end,
            onError,
          }
        : null,
  };
}
