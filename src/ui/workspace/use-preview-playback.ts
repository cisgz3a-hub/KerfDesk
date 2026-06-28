import { useEffect, useRef } from 'react';

import type { Toolpath } from '../../core/job';
import { useUiStore, type PreviewPlaybackSpeed } from '../state/ui-store';

const PLAYBACK_DURATION_MS: Record<PreviewPlaybackSpeed, number> = {
  slow: 60_000,
  normal: 30_000,
  fast: 10_000,
};

export function usePreviewPlayback(previewMode: boolean, toolpath: Toolpath | null): void {
  const playing = useUiStore((s) => s.previewPlaying);
  const playbackSpeed = useUiStore((s) => s.previewPlaybackSpeed);
  const scrubberT = useUiStore((s) => s.scrubberT);
  const setPreviewPlaying = useUiStore((s) => s.setPreviewPlaying);
  const setScrubberT = useUiStore((s) => s.setScrubberT);
  const scrubberRef = useRef(scrubberT);
  const routeLength = toolpath?.totalLength ?? 0;
  const hasPlayableRoute = routeLength > 0;

  useEffect(() => {
    scrubberRef.current = scrubberT;
  }, [scrubberT]);

  useEffect(() => {
    if ((!previewMode || !hasPlayableRoute) && playing) setPreviewPlaying(false);
  }, [hasPlayableRoute, playing, previewMode, setPreviewPlaying]);

  useEffect(() => {
    if (!previewMode || !playing || !hasPlayableRoute) return;
    let cancelled = false;
    let frameId = 0;
    let lastFrameAt: number | null = null;
    const durationMs = PLAYBACK_DURATION_MS[playbackSpeed];

    if (scrubberRef.current >= 1) {
      scrubberRef.current = 0;
      setScrubberT(0);
    }

    const tick = (time: number): void => {
      if (cancelled) return;
      if (lastFrameAt === null) {
        lastFrameAt = time;
        frameId = requestAnimationFrame(tick);
        return;
      }
      const deltaMs = Math.max(0, time - lastFrameAt);
      lastFrameAt = time;
      const next = Math.min(1, scrubberRef.current + deltaMs / durationMs);
      scrubberRef.current = next;
      setScrubberT(next);
      if (next >= 1) {
        setPreviewPlaying(false);
        return;
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [
    playbackSpeed,
    hasPlayableRoute,
    playing,
    previewMode,
    setPreviewPlaying,
    setScrubberT,
  ]);
}
