// Live checkerboard detection over a playing <video> (ADR-108 wizard). Every
// tick grabs a downscaled frame, runs the pure detector, and reports corners
// scaled back to full-resolution camera pixels — the coordinates the solve
// captures use. Also tracks how many consecutive ticks detected, so
// auto-capture can require a briefly HELD pose instead of a lucky frame.

import { useEffect, useRef, useState } from 'react';
import { type CheckerboardSpec, detectCheckerboard, toGrayImage } from '../../../core/camera';
import type { Vec2 } from '../../../core/scene';
import { captureVideoFrame, liveDetectScale } from '../frame-capture';

const DETECT_INTERVAL_MS = 250;

export type LiveDetectionState = {
  // Corners in FULL-RESOLUTION camera pixels, or null when not detecting.
  readonly corners: ReadonlyArray<Vec2> | null;
  readonly frameWidth: number;
  readonly frameHeight: number;
  // Consecutive successful detections (resets on any miss).
  readonly stableTicks: number;
};

const IDLE: LiveDetectionState = { corners: null, frameWidth: 0, frameHeight: 0, stableTicks: 0 };

/** Poll `video` while `enabled`, detecting `spec` at a reduced scale. */
export function useLiveDetection(
  video: HTMLVideoElement | null,
  spec: CheckerboardSpec,
  enabled: boolean,
): LiveDetectionState {
  const [state, setState] = useState<LiveDetectionState>(IDLE);
  const stableRef = useRef(0);

  useEffect(() => {
    if (!enabled || video === null) {
      stableRef.current = 0;
      setState(IDLE);
      return undefined;
    }
    const id = setInterval(() => {
      const next = detectTick(video, spec, stableRef.current);
      stableRef.current = next.stableTicks;
      setState(next);
    }, DETECT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [video, spec, enabled]);

  return state;
}

function detectTick(
  video: HTMLVideoElement,
  spec: CheckerboardSpec,
  prevStable: number,
): LiveDetectionState {
  const scale = liveDetectScale(video.videoWidth);
  const frame = captureVideoFrame(video, scale);
  if (frame === null) return IDLE;
  const detection = detectCheckerboard(toGrayImage(frame), spec);
  const frameWidth = video.videoWidth;
  const frameHeight = video.videoHeight;
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
