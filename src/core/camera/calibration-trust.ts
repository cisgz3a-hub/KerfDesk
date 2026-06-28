// Calibration trust assessment (ADR-095, v2.e). The reprojection RMS alone does NOT
// indicate a usable calibration: under detection noise the weakly-observed k3,k4
// terms overfit to absurd values while the RMS stays low (DECISIONS.md v2.c finding).
// This pure check is the gate the wizard's "Apply Calibration?" toggle consults —
// it flags implausible distortion coefficients, a poor fit, and uneven board coverage.

import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';
import type { QuadrantCoverage } from './calibrate-metrics';

// A Kannala-Brandt theta-polynomial coefficient above this magnitude is physically
// implausible — a sane wide fisheye keeps every term well under 1; the noise overfit
// pushes k3 into the hundreds. A ceiling, not a tight physical bound.
const MAX_ABS_DISTORTION_COEFFICIENT = 1;
// Above this per-corner reprojection RMS the fit is poor regardless of coefficients.
const MAX_TRUSTED_RMS_PX = 1.5;
// Each image quadrant should hold at least this share of the detected corners; a
// near-empty quadrant means that part of the field was never constrained.
const MIN_QUADRANT_COVERAGE_FRACTION = 0.1;
// The principal point should sit within the frame; allow this fraction of slop past
// each edge before flagging a degenerate fit that pushed it far outside.
const PRINCIPAL_POINT_MARGIN_FRACTION = 0.25;

const COEFFICIENT_LABELS = ['k1', 'k2', 'k3', 'k4'] as const;
type CoefficientLabel = (typeof COEFFICIENT_LABELS)[number];

export type TrustReason =
  | {
      readonly kind: 'coefficient-out-of-bounds';
      readonly coefficient: CoefficientLabel;
      readonly value: number;
      readonly bound: number;
    }
  | { readonly kind: 'rms-too-high'; readonly rmsPx: number; readonly threshold: number }
  | {
      readonly kind: 'uneven-coverage';
      readonly minQuadrantFraction: number;
      readonly threshold: number;
    }
  | { readonly kind: 'intrinsics-implausible'; readonly detail: 'focal' | 'principal-point' };

export type TrustVerdict =
  | { readonly kind: 'trusted' }
  | { readonly kind: 'suspect'; readonly reasons: ReadonlyArray<TrustReason> };

export type TrustInput = {
  readonly intrinsics: CameraIntrinsics;
  readonly distortion: FisheyeDistortion;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly rmsPx: number;
  readonly coverage: ReadonlyArray<QuadrantCoverage>;
};

/** Assess whether a solved calibration is plausible enough to apply. */
export function assessCalibrationTrust(input: TrustInput): TrustVerdict {
  const reasons: TrustReason[] = [
    ...intrinsicsReasons(input.intrinsics, input.imageWidth, input.imageHeight),
    ...coefficientReasons(input.distortion),
    ...rmsReasons(input.rmsPx),
    ...coverageReasons(input.coverage),
  ];
  return reasons.length === 0 ? { kind: 'trusted' } : { kind: 'suspect', reasons };
}

// The distortion+RMS checks structurally cannot see a degenerate K (a non-positive
// focal or a principal point thrown far outside the frame) that still reprojects with
// a low RMS — so the gate must inspect the intrinsics it is gating directly.
function intrinsicsReasons(
  intrinsics: CameraIntrinsics,
  imageWidth: number,
  imageHeight: number,
): TrustReason[] {
  const focalOk =
    Number.isFinite(intrinsics.fx) &&
    Number.isFinite(intrinsics.fy) &&
    intrinsics.fx > 0 &&
    intrinsics.fy > 0;
  if (!focalOk) return [{ kind: 'intrinsics-implausible', detail: 'focal' }];
  const marginX = imageWidth * PRINCIPAL_POINT_MARGIN_FRACTION;
  const marginY = imageHeight * PRINCIPAL_POINT_MARGIN_FRACTION;
  const ppOk =
    Number.isFinite(intrinsics.cx) &&
    Number.isFinite(intrinsics.cy) &&
    intrinsics.cx >= -marginX &&
    intrinsics.cx <= imageWidth + marginX &&
    intrinsics.cy >= -marginY &&
    intrinsics.cy <= imageHeight + marginY;
  return ppOk ? [] : [{ kind: 'intrinsics-implausible', detail: 'principal-point' }];
}

function coefficientReasons(distortion: FisheyeDistortion): TrustReason[] {
  const reasons: TrustReason[] = [];
  for (let i = 0; i < distortion.length; i += 1) {
    const value = distortion[i] ?? 0;
    const coefficient = COEFFICIENT_LABELS[i] ?? 'k4';
    if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_DISTORTION_COEFFICIENT) {
      reasons.push({
        kind: 'coefficient-out-of-bounds',
        coefficient,
        value,
        bound: MAX_ABS_DISTORTION_COEFFICIENT,
      });
    }
  }
  return reasons;
}

function rmsReasons(rmsPx: number): TrustReason[] {
  if (!Number.isFinite(rmsPx) || rmsPx > MAX_TRUSTED_RMS_PX) {
    return [{ kind: 'rms-too-high', rmsPx, threshold: MAX_TRUSTED_RMS_PX }];
  }
  return [];
}

function coverageReasons(coverage: ReadonlyArray<QuadrantCoverage>): TrustReason[] {
  const total = coverage.reduce((sum, quadrant) => sum + quadrant.corners, 0);
  if (total === 0 || coverage.length === 0) {
    return [
      {
        kind: 'uneven-coverage',
        minQuadrantFraction: 0,
        threshold: MIN_QUADRANT_COVERAGE_FRACTION,
      },
    ];
  }
  const minCorners = coverage.reduce((min, quadrant) => Math.min(min, quadrant.corners), Infinity);
  const minFraction = minCorners / total;
  if (minFraction < MIN_QUADRANT_COVERAGE_FRACTION) {
    return [
      {
        kind: 'uneven-coverage',
        minQuadrantFraction: minFraction,
        threshold: MIN_QUADRANT_COVERAGE_FRACTION,
      },
    ];
  }
  return [];
}
