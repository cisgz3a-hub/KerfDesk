// Inspector playback state (ADR-255 stage 5): a route-distance playhead with
// play/pause, speed, scrub, and per-segment stepping, advanced by rAF.
//
// v1 advances by DISTANCE at a nominal rate so playback length is predictable
// on any program; stage 8 replaces the rate with planner-true seconds.

import { useCallback, useEffect, useRef, useState } from 'react';

const NOMINAL_MM_PER_SEC = 60;
const MAX_FRAME_SECONDS = 0.1;

export type PlaybackState = {
  readonly routeMm: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly setRouteMm: (routeMm: number) => void;
  readonly setSpeed: (speed: number) => void;
  readonly togglePlay: () => void;
  readonly stepBy: (deltaMm: number) => void;
  readonly restart: () => void;
};

export function useInspectorPlayback(totalRouteMm: number): PlaybackState {
  const [routeMm, setRoute] = useState(totalRouteMm);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const routeRef = useRef(routeMm);
  routeRef.current = routeMm;

  // A new program resets the playhead to "fully drawn" so the Inspector opens
  // showing the whole job (LightBurn's preview does the same).
  useEffect(() => {
    setRoute(totalRouteMm);
    setPlaying(false);
  }, [totalRouteMm]);

  const clamp = useCallback(
    (value: number) => Math.min(Math.max(value, 0), totalRouteMm),
    [totalRouteMm],
  );

  useEffect(() => {
    if (!playing || totalRouteMm <= 0) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const elapsed = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
      last = now;
      const next = routeRef.current + elapsed * NOMINAL_MM_PER_SEC * speed;
      if (next >= totalRouteMm) {
        setRoute(totalRouteMm);
        setPlaying(false);
        return;
      }
      setRoute(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, totalRouteMm]);

  return {
    routeMm,
    playing,
    speed,
    setRouteMm: (value) => {
      setPlaying(false);
      setRoute(clamp(value));
    },
    setSpeed,
    togglePlay: () => {
      setPlaying((wasPlaying) => {
        // Replaying from the end restarts rather than sticking at 100%.
        if (!wasPlaying && routeRef.current >= totalRouteMm) setRoute(0);
        return !wasPlaying;
      });
    },
    stepBy: (deltaMm) => {
      setPlaying(false);
      setRoute((current) => clamp(current + deltaMm));
    },
    restart: () => {
      setPlaying(false);
      setRoute(0);
    },
  };
}
