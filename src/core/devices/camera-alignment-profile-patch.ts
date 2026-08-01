import type { CameraCalibration, CameraCaptureBinding } from '../camera';
import type { DeviceProfile } from './device-profile';

/** Remove only an inherited rectified alignment whose lens model truly changed. */
export function profileWithoutStaleRectifiedAlignment(
  current: DeviceProfile,
  patch: Partial<DeviceProfile>,
  next: DeviceProfile,
): DeviceProfile {
  if (
    cameraCalibrationsEqual(next.cameraCalibration, current.cameraCalibration) ||
    Object.hasOwn(patch, 'cameraAlignment') ||
    current.cameraAlignment?.basis !== 'rectified'
  ) {
    return next;
  }
  const { cameraAlignment: _staleAlignment, ...withoutAlignment } = next;
  return withoutAlignment;
}

function cameraCalibrationsEqual(
  left: CameraCalibration | undefined,
  right: CameraCalibration | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    intrinsicsEqual(left, right) &&
    distortionEqual(left, right) &&
    calibrationMetadataEqual(left, right) &&
    captureBindingsEqual(left.capture, right.capture)
  );
}

function intrinsicsEqual(left: CameraCalibration, right: CameraCalibration): boolean {
  return (
    left.intrinsics.fx === right.intrinsics.fx &&
    left.intrinsics.fy === right.intrinsics.fy &&
    left.intrinsics.cx === right.intrinsics.cx &&
    left.intrinsics.cy === right.intrinsics.cy
  );
}

function distortionEqual(left: CameraCalibration, right: CameraCalibration): boolean {
  return left.distortion.every((value, index) => value === right.distortion[index]);
}

function calibrationMetadataEqual(left: CameraCalibration, right: CameraCalibration): boolean {
  return (
    left.imageWidth === right.imageWidth &&
    left.imageHeight === right.imageHeight &&
    left.rmsPx === right.rmsPx &&
    left.calibratedAt === right.calibratedAt
  );
}

function captureBindingsEqual(
  left: CameraCaptureBinding | undefined,
  right: CameraCaptureBinding | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    left.version === right.version &&
    left.sourceKind === right.sourceKind &&
    left.sourceId === right.sourceId &&
    left.width === right.width &&
    left.height === right.height &&
    left.resizeMode === right.resizeMode
  );
}
