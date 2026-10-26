// Refresh the held bed picture from anywhere (ADR-663 Amendment 1): Alt+C,
// LightBurn's Update Overlay key, and after a job finishes. It takes the same
// still as Refresh picture in the Camera panel and shows it on the canvas. A
// camera on the laser head pictures the bed by moving the head (ADR-449), so it
// is never refreshed this way; its Capture buttons stay in the panel.

import { isHeadCameraModel } from '../../../core/camera/model/head-camera';
import { BROWSER_FREE_BUILD } from '../../../platform/build-capabilities';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useToastStore } from '../../state/toast-store';
import { activeCameraModelNow, ownCameraModel } from '../active-camera-model';
import { captureSourceFrame } from '../frame-source';
import { captureOverlayStill } from '../capture-overlay-still';

export type RefreshOutcome =
  | 'refreshed'
  | 'no-camera'
  | 'not-calibrated'
  | 'head-camera'
  | 'superseded'
  | 'failed';

/** Take a new held picture with the running, calibrated camera and show it. */
export async function refreshCameraPicture(
  capture: typeof captureSourceFrame = captureSourceFrame,
): Promise<RefreshOutcome> {
  const { sourceState } = useCameraStore.getState();
  if (sourceState.kind !== 'live') return 'no-camera';
  const own = ownCameraModel(useStore.getState().project.device, sourceState);
  if (own !== undefined && isHeadCameraModel(own)) return 'head-camera';
  if (activeCameraModelNow() === undefined) return 'not-calibrated';
  const result = await captureOverlayStill(capture, { showOverlay: true, activatePlacement: true });
  if (result !== 'captured') return result;
  return 'refreshed';
}

// How long Alt+C waits for a camera it had to start before it gives up.
export const PENDING_REFRESH_MS = 30_000;

let pendingRefreshUntil = 0;

/**
 * Alt+C. With the camera running, refresh now. Otherwise open the Camera
 * panel, which starts the remembered camera, and refresh once it runs.
 */
export function refreshCameraPictureFromKey(now: number = Date.now()): void {
  if (useCameraStore.getState().sourceState.kind === 'live') {
    void refreshCameraPicture().then(reportRefresh);
    return;
  }
  pendingRefreshUntil = now + PENDING_REFRESH_MS;
  if (!useCameraStore.getState().panelOpen) useCameraStore.getState().togglePanel();
}

/** True once for a refresh Alt+C asked for while the camera was not running. */
export function takePendingRefresh(now: number = Date.now()): boolean {
  const pending = now <= pendingRefreshUntil;
  pendingRefreshUntil = 0;
  return pending;
}

/** Say why a refresh the operator asked for did not happen; a refresh speaks for itself. */
export function reportRefresh(outcome: RefreshOutcome): void {
  const message = refreshMessage(outcome);
  if (message !== null)
    useToastStore.getState().pushToast(message, 'info', { key: 'camera-refresh' });
}

function refreshMessage(outcome: RefreshOutcome): string | null {
  switch (outcome) {
    case 'refreshed':
    case 'superseded':
      return null;
    case 'no-camera':
      return 'Start the camera to refresh its picture.';
    case 'not-calibrated':
      return BROWSER_FREE_BUILD
        ? 'The camera picture shows on the canvas once the camera is set up, a Pro tool in the desktop app.'
        : 'Set up the camera first (Tools → Camera → Set up camera), so its picture lines up with the bed.';
    case 'head-camera':
      return 'A camera on the laser head takes its pictures with Capture here or Capture bed in the Camera panel.';
    case 'failed':
      return 'The camera picture could not be read. Try again.';
  }
}
