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
import { fitCameraModel, type CameraFitFailure } from '../model/fit-camera-model';
import type { BedTargetLayout } from './bed-target';
import { detectRingMarks } from './ring-detect';
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
  | { readonly kind: 'failed'; readonly reason: 'no-marks' | TargetMatchFailure }
  | { readonly kind: 'failed'; readonly reason: CameraFitFailure['reason'] };

// Rings the matcher found this share of the target, or better, are enough to
// fit four distortion terms; fewer fit the two dominant ones only.
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
  if (match.kind === 'failed') return match;
  const height = input.sheetThicknessMm;
  const points = match.correspondences.map((c) => ({
    world: bedPoint(c.mark.x, c.mark.y, height),
    pixel: c.pixel,
  }));
  const { width, height: imageHeight } = input.frame;
  const fit = fitCameraModel([{ points }], {
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
      dxMm: seen === null ? Number.NaN : seen.x - c.mark.x,
      dyMm: seen === null ? Number.NaN : seen.y - c.mark.y,
      rejected: Number.isNaN(residuals[i] ?? Number.NaN),
    };
  });
  const kept = markErrors.filter((e) => !e.rejected).map((e) => Math.hypot(e.dxMm, e.dyMm));
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
