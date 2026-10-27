// Camera placement latches once the canvas draws a camera picture at its place
// on the bed, wherever that picture came from: the camera that starts by
// itself (ADR-663 Amendment 1), the Camera panel, Refresh, Alt+C or a head
// camera's capture. Job Review's camera Start-from warning (ADR-228
// Amendment 1) keys on the latch, so it no longer depends on the panel having
// been opened (ADR-663 Amendment 4, rolling audit v4 H6-P1-1). The latch
// stays when the picture is hidden; Exit camera placement clears it.

import { useEffect } from 'react';
import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import { useCameraStore, type CameraStore } from '../state/camera-store';

/** True while the overlay draws a camera picture: `model` is the one it draws through. */
export function cameraPictureOnCanvas(
  camera: Pick<CameraStore, 'overlayVisible' | 'bedPicture' | 'overlayStill' | 'sourceState'>,
  model: CameraModelRecord | undefined,
): boolean {
  if (!camera.overlayVisible) return false;
  // A bed picture is already on the bed's own grid and needs no model.
  if (camera.bedPicture !== null) return true;
  return (
    model !== undefined && (camera.overlayStill !== null || camera.sourceState.kind === 'live')
  );
}

/** Latches camera placement while the canvas draws a camera picture. */
export function useCameraPlacementLatch(model: CameraModelRecord | undefined): void {
  const shown = useCameraStore((camera) => cameraPictureOnCanvas(camera, model));
  const activate = useCameraStore((camera) => camera.activatePlacement);
  useEffect(() => {
    if (shown && !useCameraStore.getState().placementActive) activate();
  }, [activate, shown]);
}
