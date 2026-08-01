// Inspector playback state (ADR-255 stage 5, time-true since stage 8b).
//
// A thin React wrapper over playback-transport: every rule lives there and
// is unit-tested, this file only owns the rAF loop and the ref the loop
// reads. The ref is written on EVERY transition — React syncs state on the
// next render, and a stale ref is what made "press Play at the end" a no-op.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  advance,
  initialTransport,
  restart,
  scrubTo,
  stepBy,
  togglePlay,
  type TransportState,
} from './playback-transport';

const MAX_FRAME_SECONDS = 0.1;

export type PlaybackState = {
  /** Playhead position in planner seconds. */
  readonly routeMm: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly setRouteMm: (seconds: number) => void;
  readonly setSpeed: (speed: number) => void;
  readonly togglePlay: () => void;
  readonly stepBy: (deltaSeconds: number) => void;
  readonly restart: () => void;
};

export function useInspectorPlayback(totalSeconds: number): PlaybackState {
  const [transport, setTransport] = useState<TransportState>(() => initialTransport(totalSeconds));
  const [speed, setSpeed] = useState(1);
  const transportRef = useRef(transport);

  const commit = useCallback((next: TransportState) => {
    transportRef.current = next;
    setTransport(next);
  }, []);

  // A new program opens fully drawn, so the whole job is visible at once.
  useEffect(() => {
    commit(initialTransport(totalSeconds));
  }, [commit, totalSeconds]);

  useEffect(() => {
    if (!transport.playing || totalSeconds <= 0) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const elapsed = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;
      const next = advance(transportRef.current, elapsed, speed, totalSeconds);
      commit(next);
      if (next.playing) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [commit, transport.playing, speed, totalSeconds]);

  return {
    routeMm: transport.seconds,
    playing: transport.playing,
    speed,
    setRouteMm: (seconds) => commit(scrubTo(seconds, totalSeconds)),
    setSpeed,
    togglePlay: () => commit(togglePlay(transportRef.current, totalSeconds)),
    stepBy: (deltaSeconds) => commit(stepBy(transportRef.current, deltaSeconds, totalSeconds)),
    restart: () => commit(restart()),
  };
}
