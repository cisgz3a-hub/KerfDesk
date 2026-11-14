// A network camera's calibration made on another computer and not yet checked
// on this one (ADR-692 Amendments 3 and 4). It is used because a camera
// answers at the same address, which the address alone cannot tell apart
// from another camera there (camera audit v2 K6-P2-1). Until a Check camera
// on this computer finds the camera where the calibration puts it, the Camera
// panel and Job Review both say so. Check camera, or Fix a small offset,
// keeps a view of the camera here, which ends it.

import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import { modelFromElsewhere } from '../../../core/camera/model/saved-cameras';
import type { DeviceProfile } from '../../../core/devices/device-profile';
import type { CameraSourceState } from '../../state/camera-store';
import { ownCameraModel } from '../active-camera-model';
import { cameraSourceIdentity } from '../frame-source';
import { hasViewReference } from './view-reference';

/** The running camera's calibration when it came from another computer and is unchecked here. */
export function uncheckedCalibrationFromElsewhere(
  device: Pick<DeviceProfile, 'cameraModel' | 'otherCameraModels'>,
  sourceState: CameraSourceState,
): CameraModelRecord | null {
  if (sourceState.kind !== 'live') return null;
  const own = ownCameraModel(device, sourceState);
  if (own === undefined) return null;
  if (!modelFromElsewhere(own, cameraSourceIdentity(sourceState.source))) return null;
  return hasViewReference(own) ? null : own;
}

export const CALIBRATION_ELSEWHERE_NOTICE =
  'This calibration was made on another computer and has not been checked here: run Check camera.';

export const CALIBRATION_ELSEWHERE_DETAIL =
  'It is used because a camera answers at the same address, which may be another camera. Until Check camera finds the camera where this calibration puts it, the picture may not line up with the burn, and KerfDesk cannot warn you if the camera has moved.';

export const CALIBRATION_ELSEWHERE_JOB_WARNING =
  "Camera placement is on, but the camera's calibration was made on another computer and has not been checked here: a camera at the same address may be another camera, so the job may not burn where the picture shows it. Run Check camera in the Camera panel first, and watch the Frame.";
