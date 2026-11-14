// The camera-moved check on a live picture (ADR-663 Amendment 8, camera
// audit v2 K2-P1-1). A held picture is checked each time it is taken, but a
// live picture was checked only once, three seconds after the camera started:
// a camera knocked 0.8° afterwards stayed "steady" through 24 s of use and a
// finished job, while artwork burned 7-10 mm from where it showed, and a
// zoom changed between sessions read as one weak match and said nothing. So
// while the live picture is on the canvas it is checked again every
// LIVE_MOVED_CHECK_MS, in the camera picture worker (ADR-663 Amendment 6).
// Weak matches add up across these checks, so a view that stays
// unrecognisable says "changed" on the next one. No check runs while a job
// streams: it cannot move that job, and the next check after it ends runs.

import { useCameraStore } from '../../state/camera-store';
import { useLaserStore } from '../../state/laser-store';
import { isActiveJob } from '../../state/laser-store-helpers';
import type { ActiveCameraSource } from '../frame-source';
import { checkStartedCameraMoved } from './moved-check-capture';

/** How often a live picture on the canvas is checked for a moved camera, ms. */
export const LIVE_MOVED_CHECK_MS = 15_000;

export type LiveCheckDeps = {
  readonly check?: (source: ActiveCameraSource) => Promise<void>;
  readonly everyMs?: number;
};

/** Check the live picture on the canvas every so often; returns stop. */
export function checkLivePictureForMoves(deps: LiveCheckDeps = {}): () => void {
  const check = deps.check ?? checkStartedCameraMoved;
  let running = false;
  const tick = (): void => {
    const camera = useCameraStore.getState();
    const { sourceState } = camera;
    // A held picture is checked when it is taken; a hidden picture places nothing.
    if (running || sourceState.kind !== 'live') return;
    if (camera.overlayStill !== null || !camera.overlayVisible) return;
    if (isActiveJob(useLaserStore.getState().streamer)) return;
    running = true;
    void check(sourceState.source)
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };
  const timer = setInterval(tick, deps.everyMs ?? LIVE_MOVED_CHECK_MS);
  return () => clearInterval(timer);
}
