// Persisted camera calibration (ADR-106 reserved field, ADR-107 v2.d). Stored on
// DeviceProfile so a de-fisheye overlay survives reload. Carries the frame
// resolution the intrinsics are expressed in — so an apply-time resolution mismatch
// can warn — plus the reprojection RMS as a coarse trust signal. Pure core; the
// normaliser validates untrusted persisted JSON and returns undefined on any defect.

import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';

export type CameraCalibration = {
  readonly intrinsics: CameraIntrinsics;
  readonly distortion: FisheyeDistortion;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly rmsPx: number;
  // Epoch milliseconds, supplied by the caller — core reads no clock.
  readonly calibratedAt: number;
};

/** The solved fields a CameraCalibration is built from (a CalibrationResult 'ok' is one). */
export type CalibrationSnapshot = {
  readonly intrinsics: CameraIntrinsics;
  readonly distortion: FisheyeDistortion;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly rmsPx: number;
};

/**
 * Build a persisted CameraCalibration from a solved calibration, stamping the time the
 * caller supplies (core takes no clock). The single verified field mapping, so the UI
 * does not re-invent it.
 */
export function toCameraCalibration(
  solved: CalibrationSnapshot,
  calibratedAt: number,
): CameraCalibration {
  return {
    intrinsics: solved.intrinsics,
    distortion: solved.distortion,
    imageWidth: solved.imageWidth,
    imageHeight: solved.imageHeight,
    rmsPx: solved.rmsPx,
    calibratedAt,
  };
}

/** Validate persisted JSON into a CameraCalibration, or undefined if malformed. */
export function normalizeCameraCalibration(value: unknown): CameraCalibration | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // Narrowing an already-checked non-null object to read its fields; no unsafe widening.
  const raw = value as Record<string, unknown>;
  const intrinsics = normalizeIntrinsics(raw.intrinsics);
  const distortion = normalizeDistortion(raw.distortion);
  const imageWidth = finitePositive(raw.imageWidth);
  const imageHeight = finitePositive(raw.imageHeight);
  const rmsPx = finiteNonNegative(raw.rmsPx);
  const calibratedAt = finiteNonNegative(raw.calibratedAt);
  if (
    intrinsics === undefined ||
    distortion === undefined ||
    imageWidth === undefined ||
    imageHeight === undefined ||
    rmsPx === undefined ||
    calibratedAt === undefined
  ) {
    return undefined;
  }
  return { intrinsics, distortion, imageWidth, imageHeight, rmsPx, calibratedAt };
}

function normalizeIntrinsics(value: unknown): CameraIntrinsics | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  // Narrowing an already-checked non-null object to read its fields.
  const raw = value as Record<string, unknown>;
  const fx = finitePositive(raw.fx);
  const fy = finitePositive(raw.fy);
  const cx = finiteNumber(raw.cx);
  const cy = finiteNumber(raw.cy);
  if (fx === undefined || fy === undefined || cx === undefined || cy === undefined)
    return undefined;
  return { fx, fy, cx, cy };
}

function normalizeDistortion(value: unknown): FisheyeDistortion | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const k1 = finiteNumber(value[0]);
  const k2 = finiteNumber(value[1]);
  const k3 = finiteNumber(value[2]);
  const k4 = finiteNumber(value[3]);
  if (k1 === undefined || k2 === undefined || k3 === undefined || k4 === undefined)
    return undefined;
  return [k1, k2, k3, k4];
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finitePositive(value: unknown): number | undefined {
  const num = finiteNumber(value);
  return num !== undefined && num > 0 ? num : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  const num = finiteNumber(value);
  return num !== undefined && num >= 0 ? num : undefined;
}
