// The saved calibration of the camera that is running (ADR-445). Every camera
// consumer reads the model through here, so switching cameras switches the
// lens and pose with it. With no camera running, or a camera that has no
// calibration of its own, it is the newest calibration, which then reports
// that it belongs to another camera.

import { useMemo } from 'react';
import { cameraModelInUse, ownModelFor } from '../../core/camera/model/saved-cameras';
import type { CameraModelRecord } from '../../core/camera/model/camera-model-record';
import type { DeviceProfile } from '../../core/devices/device-profile';
import { useStore } from '../state';
import { useCameraStore, type CameraSourceState } from '../state/camera-store';
import { cameraSourceIdentity } from './frame-source';

export function activeCameraModel(
  device: Pick<DeviceProfile, 'cameraModel' | 'otherCameraModels'>,
  sourceState: CameraSourceState,
): CameraModelRecord | undefined {
  return cameraModelInUse(
    device,
    sourceState.kind === 'live' ? cameraSourceIdentity(sourceState.source) : null,
  );
}

/**
 * The running camera's own calibration, with no fallback: what the Camera
 * panel reports as calibrated. With no camera running, the newest.
 */
export function ownCameraModel(
  device: Pick<DeviceProfile, 'cameraModel' | 'otherCameraModels'>,
  sourceState: CameraSourceState,
): CameraModelRecord | undefined {
  return sourceState.kind === 'live'
    ? ownModelFor(device, cameraSourceIdentity(sourceState.source))
    : device.cameraModel;
}

/** The model in use right now, outside React. */
export function activeCameraModelNow(): CameraModelRecord | undefined {
  return activeCameraModel(
    useStore.getState().project.device,
    useCameraStore.getState().sourceState,
  );
}

export function useActiveCameraModel(): CameraModelRecord | undefined {
  return useSavedCameraModel(activeCameraModel);
}

export function useOwnCameraModel(): CameraModelRecord | undefined {
  return useSavedCameraModel(ownCameraModel);
}

function useSavedCameraModel(pick: typeof activeCameraModel): CameraModelRecord | undefined {
  const cameraModel = useStore((s) => s.project.device.cameraModel);
  const otherCameraModels = useStore((s) => s.project.device.otherCameraModels);
  const sourceState = useCameraStore((s) => s.sourceState);
  return useMemo(
    () => pick({ cameraModel, otherCameraModels }, sourceState),
    [pick, cameraModel, otherCameraModels, sourceState],
  );
}
