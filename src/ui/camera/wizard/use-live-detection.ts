// Live checkerboard detection over any camera source (ADR-108 wizard,
// generalized by ADR-116). Every tick asks the caller-provided capture
// closure for a downscaled frame, runs the pure detector, and reports corners
// scaled back to full-resolution camera pixels — the coordinates the solve
// captures use. Also tracks how many consecutive ticks detected, so
// auto-capture can require a briefly HELD pose instead of a lucky frame.

import { useEffect, useRef, useState } from 'react';
import { type CheckerboardSpec, detectCheckerboard, toGrayImage } from '../../../core/camera';
import type { RgbaImage } from '../../../core/camera';
import type { Vec2 } from '../../../core/scene';

// A frame grab for one detection tick: the (downscaled) pixels plus the scale
// they were captured at, so corners can be mapped back to full resolution.
export type LiveDetectCapture = () => {
  readonly frame: RgbaImage;
  readonly scale: number;
} | null;

export type LiveDetectionState = {
  // Corners in FULL-RESOLUTION camera pixels, or null when not detecting.
  readonly corners: ReadonlyArray<Vec2> | null;
  readonly frameWidth: number;
  readonly frameHeight: number;
  // Consecutive successful detections (resets on any miss).
  readonly stableTicks: number;
};

const IDLE: LiveDetectionState = { corners: null, frameWidth: 0, frameHeight: 0, stableTicks: 0 };

/** Poll `capture` every `intervalMs` while `enabled`, detecting `spec`. */
export function useLiveDetection(
  capture: LiveDetectCapture | null,
  spec: CheckerboardSpec,
  enabled: boolean,
  intervalMs: number,
): LiveDetectionState {
  const [state, setState] = useState<LiveDetectionState>(IDLE);
  const stableRef = useRef(0);

  useEffect(() => {
    if (!enabled || capture === null) {
      stableRef.current = 0;
      setState(IDLE);
      return undefined;
    }
    const id = setInterval(() => {
      const next = detectTick(capture, spec, stableRef.current);
      stableRef.current = next.stableTicks;
      setState(next);
    }, intervalMs);
    return () => clearInterval(id);
  }, [capture, spec, enabled, intervalMs]);

  return state;
}

function detectTick(
  capture: LiveDetectCapture,
  spec: CheckerboardSpec,
  prevStable: number,
): LiveDetectionState {
  const grabbed = capture();
  if (grabbed === null) return IDLE;
  const { frame, scale } = grabbed;
  const frameWidth = Math.round(frame.width / scale);
  const frameHeight = Math.round(frame.height / scale);
  const detection = detectCheckerboard(toGrayImage(frame), spec);
  if (detection.kind !== 'ok') {
    return { corners: null, frameWidth, frameHeight, stableTicks: 0 };
  }
  return {
    corners: detection.corners.map((c) => ({ x: c.x / scale, y: c.y / scale })),
    frameWidth,
    frameHeight,
    stableTicks: prevStable + 1,
  };
}
