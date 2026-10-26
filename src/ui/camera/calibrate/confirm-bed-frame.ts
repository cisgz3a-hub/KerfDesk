// Confirm the bed a calibration saved without one was made on (meta audit
// M2-P3-3, ADR-440 Amendment 4). KerfDesk 1.0.21 and older kept no bed frame,
// so such a calibration is not used until the operator says Machine Setup's
// origin corner and bed size are still the ones it was calibrated with; the
// calibration then records them, and later bed changes move its picture as
// they do for a new one. One undo step, like any profile change. It only
// accepts a saved calibration, so it is not camera alignment and needs no Pro.

import { withConfirmedBedFrame } from '../../../core/camera/model/camera-bed-frame';
import { withReplacedCameraModel } from '../../../core/camera/model/saved-cameras';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { ownCameraModel } from '../active-camera-model';
import { cameraBedFrameNow } from '../camera-bed-frame-now';

/** Record today's origin and bed size on the running camera's own calibration; false when it has a frame. */
export function confirmOwnCameraBedFrame(): boolean {
  const { project, updateDeviceProfile } = useStore.getState();
  const own = ownCameraModel(project.device, useCameraStore.getState().sourceState);
  if (own === undefined || own.bedFrame !== undefined) return false;
  const confirmed = withConfirmedBedFrame(own, cameraBedFrameNow());
  updateDeviceProfile(withReplacedCameraModel(project.device, own, confirmed));
  return true;
}
