// Core camera barrel: the camera image type and the persisted camera profile.
// The camera model, target and solver are imported by deep path
// (core/camera/model, core/camera/target) so this barrel stays small.

export type { RgbaImage } from './rgba-image';

export type {
  CameraAlignment as CameraProfileAlignment,
  CameraAlignmentPoint,
  CameraLensCalibration,
  CameraPoint,
  CameraProfile,
  CameraReadiness,
  CameraResolution,
  CameraSource,
} from './camera-profile';
export {
  cameraProfileReadiness,
  DEFAULT_RTSP_CAMERA_URL,
  effectiveCameraSource,
  isCameraProfile,
  normalizeCameraProfile,
  validateCameraAlignmentShape,
  validateCameraProfileShape,
} from './camera-profile';
export type { CameraHomography, CameraTransformResult } from './camera-transform';
export { buildCameraTransforms } from './camera-transform';
