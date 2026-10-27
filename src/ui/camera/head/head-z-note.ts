// What KerfDesk says about a head camera's Z (ADR-449 Amendment 2). The camera
// rides up and down with the head, so its calibration holds only at the Z it
// was taken at: away from it the picture is not used, and the panel says how
// to bring it back. The Z is the machine position the status panel shows.

import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type { HeadCameraZChange } from '../../../core/camera/model/head-camera';

export function headZChangedMessage(change: HeadCameraZChange): string {
  const calibrated = mm(change.calibratedZMm);
  return `The head is at machine Z ${mm(change.zMm)} mm, but this camera was calibrated with it at Z ${calibrated} mm, so its picture would not line up with the burn. Move Z back to ${calibrated} mm, or calibrate the camera again at this height.`;
}

/** The rule for a head camera in use, as the Camera panel states it. */
export function headZRule(record: CameraModelRecord): string {
  const z = record.mount?.headZAtCalibrationMm;
  return z === undefined
    ? 'This calibration holds only at the head height it was taken at. After autofocus or a Z move, move Z back before placing artwork on the camera picture, or calibrate again: a new calibration records its Z, and KerfDesk then checks it for you.'
    : `Calibrated with the head at machine Z ${mm(z)} mm. After autofocus or a Z move, the camera picture is not used until Z is back there or the camera is calibrated again.`;
}

function mm(value: number): string {
  return value.toFixed(2);
}
