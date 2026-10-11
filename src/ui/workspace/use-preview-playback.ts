import { useEffect, useMemo, useRef } from 'react';

import type { Toolpath } from '../../core/job';
import type { LiveJobEstimate } from '../laser/live-job-estimate';
import { useUiStore, type PreviewPlaybackSpeed } from '../state/ui-store';
import { useStore } from '../state/store';
import {
  buildPreviewTimeline,
  elapsedSecondsAtScrubber,
  scrubberAtElapsedSeconds,
} from './preview-timeline';

const PLAYBACK_RATE: Record<PreviewPlaybackSpeed, number> = {
  slow: 1,
  normal: 10,
  fast: 40,
};

export function usePreviewPlayback(
  previewMode: boolean,
  toolpath: Toolpath | null,
  estimate: LiveJobEstimate,
): void {
  const playing = useUiStore((s) => s.previewPlaying);
  const playbackSpeed = useUiStore((s) => s.previewPlaybackSpeed);
  const scrubberT = useUiStore((s) => s.scrubberT);
  const setPreviewPlaying = useUiStore((s) => s.setPreviewPlaying);
  const setScrubberT = useUiStore((s) => s.setScrubberT);
  const external = useStore((s) => s.externalGcodePreview);
  const hasPlayableRoute = (toolpath?.totalLength ?? 0) > 0;
  const timeline = useMemo(
    () =>
      external !== null
        ? (external.timing?.timeline ?? null)
        : toolpath !== null && estimate.kind === 'estimated'
          ? buildPreviewTimeline(toolpath, estimate.breakdown)
          : null,
    [estimate, external, toolpath],
  );
  const { scrubberRef, elapsedRef } = usePlaybackScrubber(timeline, scrubberT);

  useEffect(() => {
    if ((!previewMode || !hasPlayableRoute) && playing) setPreviewPlaying(false);
  }, [hasPlayableRoute, playing, previewMode, setPreviewPlaying]);

  useEffect(() => {
    if (!previewMode || !playing || !hasPlayableRoute) return;
    let cancelled = false;
    let frameId = 0;
    let lastFrameAt: number | null = null;
    const playbackRate = PLAYBACK_RATE[playbackSpeed];

    if (
      scrubberRef.current >= 1 &&
      (timeline === null || elapsedRef.current >= timeline.totalSeconds)
    ) {
      scrubberRef.current = 0;
      elapsedRef.current = 0;
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
      const next =
        timeline === null
          ? Math.min(1, scrubberRef.current + deltaMs / fallbackDurationMs(playbackSpeed))
          : scrubberAtElapsedSeconds(
              timeline,
              (elapsedRef.current += (deltaMs / 1000) * playbackRate),
            );
      scrubberRef.current = next;
      setScrubberT(next);
      if (timeline === null ? next >= 1 : elapsedRef.current >= timeline.totalSeconds) {
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
    timeline,
    elapsedRef,
    scrubberRef,
  ]);
}

function usePlaybackScrubber(
  timeline: ReturnType<typeof buildPreviewTimeline> | null,
  scrubberT: number,
) {
  const scrubberRef = useRef(scrubberT);
  const elapsedRef = useRef(0);
  const timelineRef = useRef<typeof timeline>(null);
  useEffect(() => {
    // Dwell time cannot be recovered from stationary distance. Only re-seek
    // for a user scrub or a new timeline, not our own animation frame writes.
    if (
      timeline !== null &&
      (timelineRef.current !== timeline || scrubberRef.current !== scrubberT)
    ) {
      elapsedRef.current = elapsedSecondsAtScrubber(timeline, scrubberT);
    }
    scrubberRef.current = scrubberT;
    timelineRef.current = timeline;
  }, [scrubberT, timeline]);
  return { scrubberRef, elapsedRef };
}

function fallbackDurationMs(speed: PreviewPlaybackSpeed): number {
  return 30_000 / PLAYBACK_RATE[speed];
}
