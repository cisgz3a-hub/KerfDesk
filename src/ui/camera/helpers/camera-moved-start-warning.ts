// The "camera moved?" warning as Job Review says it (ADR-663 Amendment 5): an
// undismissed warning for the running camera's own calibration, read into the
// Start snapshot so Job Review shows it beside the camera placement advice.
// A calibration made on another computer and not yet checked here has no view
// to watch for a move, so Job Review says that instead (ADR-692 Amendment 4).

import type { DeviceProfile } from '../../../core/devices/device-profile';
import type { CameraSourceState } from '../../state/camera-store';
import { ownCameraModel } from '../active-camera-model';
import {
  CALIBRATION_ELSEWHERE_JOB_WARNING,
  uncheckedCalibrationFromElsewhere,
} from './calibration-elsewhere';
import {
  cameraMovedJobWarning,
  shownCameraMovedWarning,
  useCameraMovedStore,
} from './camera-moved-store';

export function cameraMovedStartWarning(
  device: Pick<DeviceProfile, 'cameraModel' | 'otherCameraModels'>,
  sourceState: CameraSourceState,
): string | null {
  const { state, dismissedFor } = useCameraMovedStore.getState();
  const shown = shownCameraMovedWarning(
    state,
    dismissedFor,
    ownCameraModel(device, sourceState)?.calibratedAt,
  );
  if (shown !== null) return cameraMovedJobWarning(shown);
  return uncheckedCalibrationFromElsewhere(device, sourceState) === null
    ? null
    : CALIBRATION_ELSEWHERE_JOB_WARNING;
}
