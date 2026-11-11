// The newest picture of a bridge camera for the overlay, decoded off the UI
// thread at the canvas's size (ADR-440 Amendment 10). Pictures come at most
// every IDLE_FRAME_MS, or every JOB_FRAME_MS while a job streams, so the
// overlay's one upload per picture stays far below the job-time budget.

import { useEffect, useRef, useState } from 'react';
import { useLaserStore } from '../../state/laser-store';
import { OVERLAY_MAX_WIDTH } from '../picture-worker/picture-size';
import { isActiveJob } from '../../state/laser-store-helpers';
import type { ActiveCameraSource } from '../frame-source';
import {
  IDLE_FRAME_MS,
  JOB_FRAME_MS,
  startMachineFrameFeed,
  type MachineFrame,
} from './machine-frame-feed';

export function useMachineFrame(
  source: ActiveCameraSource | null,
  displayWidth: number,
): MachineFrame | null {
  const [frame, setFrame] = useState<MachineFrame | null>(null);
  const jobRunning = useLaserStore((s) => isActiveJob(s.streamer));
  const widthRef = useRef(displayWidth);
  const jobRef = useRef(jobRunning);
  widthRef.current = displayWidth;
  jobRef.current = jobRunning;
  useEffect(() => {
    if (source === null) return undefined;
    let current: MachineFrame | null = null;
    const stop = startMachineFrameFeed(source, {
      displayWidth: () => widthRef.current,
      minIntervalMs: () => (jobRef.current ? JOB_FRAME_MS : IDLE_FRAME_MS),
      onFrame: (next) => {
        const previous = current;
        current = next;
        setFrame(next);
        // A closed bitmap is skipped by the renderer if a redraw still holds it.
        previous?.bitmap.close();
      },
    });
    if (stop === null) return undefined;
    return () => {
      stop();
      current?.bitmap.close();
      setFrame(null);
    };
  }, [source]);
  return frame;
}

/** Widest the overlay needs a bridge picture, device pixels: a little over the canvas, at most 1,920. */
export function overlayDisplayWidth(cssWidth: number | null, devicePixelRatio: number): number {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(OVERLAY_MAX_WIDTH, Math.round((cssWidth ?? 1280) * ratio * 1.5));
}
