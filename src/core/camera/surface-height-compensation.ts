import type { CameraAlignment } from './camera-alignment';
import type { CameraCalibration } from './camera-calibration';
import type { CameraIntrinsics } from './fisheye';
import type { Mat3 } from './homography';
import { invertMat3 } from './mat3';
import { scaleIntrinsicsToFrame } from './resolution-match';

export type SurfaceHeightCompensationFailure =
  | 'alignment-height-unknown'
  | 'invalid-height'
  | 'needs-lens-calibration'
  | 'needs-rectified-alignment'
  | 'invalid-camera-pose';

export type SurfaceHeightCompensationResult =
  | { readonly ok: true; readonly homography: Mat3; readonly adjusted: boolean }
  | { readonly ok: false; readonly reason: SurfaceHeightCompensationFailure };

const HEIGHT_EPSILON_MM = 1e-6;
const VECTOR_EPSILON = 1e-10;

/**
 * Re-project a camera-to-bed homography from its alignment plane to a parallel
 * material surface. The rectified camera intrinsics and the plane homography
 * recover the camera pose; translating that plane along machine Z yields the
 * homography for the requested surface without asking the operator to re-align
 * for every material thickness.
 */
export function compensateAlignmentForSurfaceHeight(args: {
  readonly alignment: CameraAlignment;
  readonly calibration: CameraCalibration | undefined;
  readonly surfaceHeightMm: number;
}): SurfaceHeightCompensationResult {
  const { alignment, calibration, surfaceHeightMm } = args;
  if (!Number.isFinite(surfaceHeightMm) || surfaceHeightMm < 0) {
    return { ok: false, reason: 'invalid-height' };
  }
  const alignedHeight = alignment.planeHeightMm;
  if (alignedHeight === undefined) return { ok: false, reason: 'alignment-height-unknown' };
  if (Math.abs(surfaceHeightMm - alignedHeight) <= HEIGHT_EPSILON_MM) {
    return { ok: true, homography: alignment.homography, adjusted: false };
  }
  if (alignment.basis !== 'rectified') {
    return { ok: false, reason: 'needs-rectified-alignment' };
  }
  if (calibration === undefined) return { ok: false, reason: 'needs-lens-calibration' };

  const intrinsics = scaleIntrinsicsToFrame(
    calibration,
    alignment.frameWidth,
    alignment.frameHeight,
  );
  const adjusted = translateAlignmentPlane(
    alignment.homography,
    intrinsics,
    surfaceHeightMm - alignedHeight,
  );
  return adjusted === null
    ? { ok: false, reason: 'invalid-camera-pose' }
    : { ok: true, homography: adjusted, adjusted: true };
}

function translateAlignmentPlane(
  cameraToPlane: Mat3,
  intrinsics: CameraIntrinsics,
  deltaHeightMm: number,
): Mat3 | null {
  const planeToCamera = invertMat3(cameraToPlane);
  if (planeToCamera === null) return null;
  const normalized = removeIntrinsics(planeToCamera, intrinsics);
  const pose = recoverPose(normalized);
  if (pose === null) return null;
  const translatedOrigin = add(pose.translation, scale(pose.zAxis, deltaHeightMm));
  return invertMat3(applyIntrinsics(pose.xAxis, pose.yAxis, translatedOrigin, intrinsics));
}

type Vec3 = readonly [number, number, number];

function removeIntrinsics(matrix: Mat3, k: CameraIntrinsics): Mat3 {
  return [
    (matrix[0] - k.cx * matrix[6]) / k.fx,
    (matrix[1] - k.cx * matrix[7]) / k.fx,
    (matrix[2] - k.cx * matrix[8]) / k.fx,
    (matrix[3] - k.cy * matrix[6]) / k.fy,
    (matrix[4] - k.cy * matrix[7]) / k.fy,
    (matrix[5] - k.cy * matrix[8]) / k.fy,
    matrix[6],
    matrix[7],
    matrix[8],
  ];
}

function recoverPose(normalized: Mat3): {
  readonly xAxis: Vec3;
  readonly yAxis: Vec3;
  readonly zAxis: Vec3;
  readonly translation: Vec3;
} | null {
  const first: Vec3 = [normalized[0], normalized[3], normalized[6]];
  const second: Vec3 = [normalized[1], normalized[4], normalized[7]];
  const third: Vec3 = [normalized[2], normalized[5], normalized[8]];
  const averageNorm = (norm(first) + norm(second)) / 2;
  if (!Number.isFinite(averageNorm) || averageNorm < VECTOR_EPSILON) return null;
  const sign = third[2] < 0 ? -1 : 1;
  const poseScale = sign / averageNorm;
  const xAxis = unit(scale(first, poseScale));
  if (xAxis === null) return null;
  const secondScaled = scale(second, poseScale);
  const yAxis = unit(add(secondScaled, scale(xAxis, -dot(secondScaled, xAxis))));
  if (yAxis === null) return null;
  const zAxis = unit(cross(xAxis, yAxis));
  if (zAxis === null) return null;
  const translation = scale(third, poseScale);
  if (translation[2] <= VECTOR_EPSILON) return null;
  return { xAxis, yAxis, zAxis, translation };
}

function applyIntrinsics(x: Vec3, y: Vec3, origin: Vec3, k: CameraIntrinsics): Mat3 {
  return [
    k.fx * x[0] + k.cx * x[2],
    k.fx * y[0] + k.cx * y[2],
    k.fx * origin[0] + k.cx * origin[2],
    k.fy * x[1] + k.cy * x[2],
    k.fy * y[1] + k.cy * y[2],
    k.fy * origin[1] + k.cy * origin[2],
    x[2],
    y[2],
    origin[2],
  ];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(value: Vec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function unit(value: Vec3): Vec3 | null {
  const length = norm(value);
  return length < VECTOR_EPSILON ? null : scale(value, 1 / length);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
