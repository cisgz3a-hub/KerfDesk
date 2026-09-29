// One-photo bed calibration (ADR-441): find the engraved target's rings,
// index them, and fit the full camera model (lens and pose) to them in a
// single step. Because the laser put every ring at a known machine
// coordinate, the result maps camera pixels to bed millimetres directly, and
// the accuracy report is measured on the bed in millimetres at every ring,
// not inferred from pixel residuals. Pure core.

import type { GrayImage } from '../corner-subpix';
import {
  cameraCentre,
  pixelToBed,
  bedPoint,
  type CameraPose,
  type LensModel,
} from '../model/camera-model';
import type { CameraFitFailure } from '../model/fit-camera-model';
import { fitDeterminedLens, type LensFitFailure } from '../model/fit-determined-lens';
import type { BedTargetLayout } from './bed-target';
import { detectRingMarks, type RingMark } from './ring-detect';
import { matchBedTarget, type TargetMatchFailure } from './target-match';

export type BedCalibrationInput = {
  readonly frame: GrayImage;
  readonly layout: BedTargetLayout;
  /** Thickness of the sheet the target was engraved on, mm. */
  readonly sheetThicknessMm: number;
  /** Known lens from a separate lens calibration, fitted pose only. */
  readonly lens?: LensModel;
  /**
   * The operator's tape-measure reading of the camera lens above the bed, mm.
   * Needed for a camera looking straight down (see fitCameraModel); harmless
   * for a tilted one, which the photo pins far tighter than a tape measure.
   */
  readonly measuredCameraHeightMm?: number;
};

export type MarkError = {
  readonly x: number;
  readonly y: number;
  /** Where the ring was found in the photo, px. */
  readonly pixel: { readonly x: number; readonly y: number };
  /** Where the fitted model puts the detected ring, minus where it was engraved (mm). */
  readonly dxMm: number;
  readonly dyMm: number;
  readonly rejected: boolean;
};

export type BedCalibration = {
  readonly kind: 'ok';
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly markErrors: ReadonlyArray<MarkError>;
  readonly rmsErrorMm: number;
  readonly maxErrorMm: number;
  readonly foundMarks: number;
  readonly expectedMarks: number;
  readonly rmsPx: number;
  /** Camera height above the bed surface implied by the fit, mm. */
  readonly cameraHeightMm: number;
  /** How well the photo (and any measured height) pins that height down, mm. */
  readonly cameraHeightSigmaMm: number;
};

export type BedCalibrationFailure =
  | {
      readonly kind: 'failed';
      /** 'target-too-large': the rings seen run edge to edge (see targetOverfillsPicture). */
      readonly reason: 'no-marks' | 'target-too-large' | TargetMatchFailure;
    }
  | {
      readonly kind: 'failed';
      readonly reason: CameraFitFailure['reason'] | LensFitFailure['reason'];
    };

// Rings the matcher found this share of the target, or better, may fit up to
// four distortion terms; fewer fit the two dominant ones at most. Either way
// the fit keeps only the terms the rings pin down (fitDeterminedLens).
const FULL_DISTORTION_MIN_MARKS = 30;
const PRINCIPAL_POINT_SIGMA_SHARE = 0.08;
// How far off a tape-measure reading of the camera height can be, mm.
const MEASURED_HEIGHT_SIGMA_MM = 15;

export function calibrateFromBedTarget(
  input: BedCalibrationInput,
): BedCalibration | BedCalibrationFailure {
  const rings = detectRingMarks(input.frame);
  if (rings.length === 0) return { kind: 'failed', reason: 'no-marks' };
  const match = matchBedTarget(rings, input.layout);
  if (match.kind === 'failed') {
    const overfills = targetOverfillsPicture(rings, input.frame.width, input.frame.height);
    return match.reason === 'anchors-not-found' && overfills
      ? { kind: 'failed', reason: 'target-too-large' }
      : match;
  }
  const height = input.sheetThicknessMm;
  const points = match.correspondences.map((c) => ({
    world: bedPoint(c.mark.x, c.mark.y, height),
    pixel: c.pixel,
  }));
  const { width, height: imageHeight } = input.frame;
  const fit = fitDeterminedLens([{ points }], {
    imageWidth: width,
    imageHeight,
    distortionTerms: points.length >= FULL_DISTORTION_MIN_MARKS ? 4 : 2,
    principalPointSigmaPx: PRINCIPAL_POINT_SIGMA_SHARE * width,
    ...(input.lens === undefined ? {} : { fixedLens: input.lens }),
    ...(input.measuredCameraHeightMm === undefined
      ? {}
      : {
          cameraHeightPrior: {
            heightMm: input.measuredCameraHeightMm,
            sigmaMm: MEASURED_HEIGHT_SIGMA_MM,
          },
        }),
  });
  if (fit.kind === 'failed') return fit;
  const pose = fit.poses[0] as CameraPose;
  const residuals = fit.residualsPx[0] ?? [];
  const markErrors = match.correspondences.map((c, i): MarkError => {
    const seen = pixelToBed(fit.lens, pose, c.pixel, height);
    return {
      x: c.mark.x,
      y: c.mark.y,
      pixel: c.pixel,
      dxMm: seen === null ? Number.NaN : seen.x - c.mark.x,
      dyMm: seen === null ? Number.NaN : seen.y - c.mark.y,
      rejected: Number.isNaN(residuals[i] ?? Number.NaN),
    };
  });
  // A ring the model gives no bed point has no error to average.
  const kept = markErrors
    .filter((e) => !e.rejected)
    .map((e) => Math.hypot(e.dxMm, e.dyMm))
    .filter(Number.isFinite);
  return {
    kind: 'ok',
    lens: fit.lens,
    pose,
    markErrors,
    rmsErrorMm: Math.sqrt(kept.reduce((s, e) => s + e * e, 0) / Math.max(kept.length, 1)),
    maxErrorMm: kept.reduce((m, e) => Math.max(m, e), 0),
    foundMarks: match.correspondences.length,
    expectedMarks: match.expected,
    rmsPx: fit.rmsPx,
    cameraHeightMm: -cameraCentre(pose).z,
    cameraHeightSigmaMm: fit.cameraHeightSigmaMm,
  };
}

// The anchors are told apart by the rings around them, so when the target is
// too large for the picture they go unfound however clear the photo: the
// rings next to them are cut off at its edges. The rings seen then reach two
// opposite edges of the picture, within a ring diameter.
function targetOverfillsPicture(
  marks: ReadonlyArray<RingMark>,
  width: number,
  height: number,
): boolean {
  let left = Infinity;
  let top = Infinity;
  let right = Infinity;
  let bottom = Infinity;
  let diameters = 0;
  let rings = 0;
  for (const mark of marks) {
    if (mark.anchor) continue;
    const radius = Math.sqrt(mark.area / Math.PI);
    left = Math.min(left, mark.x - radius);
    top = Math.min(top, mark.y - radius);
    right = Math.min(right, width - 1 - mark.x - radius);
    bottom = Math.min(bottom, height - 1 - mark.y - radius);
    diameters += 2 * radius;
    rings += 1;
  }
  const near = rings === 0 ? 0 : diameters / rings;
  return (left < near && right < near) || (top < near && bottom < near);
}
