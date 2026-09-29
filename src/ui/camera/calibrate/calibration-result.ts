// Turning a one-photo bed calibration into what the machine profile saves and
// what the wizard says (ADR-441). The accuracy is reported as measured, in
// millimetres on the bed; a rough fit is described, never refused, because the
// operator decides whether it is good enough for their work (ADR-228).

import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import { savedMarkErrors, type BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type { Vec2 } from '../../../core/scene';
import type {
  BedCalibration,
  BedCalibrationFailure,
} from '../../../core/camera/target/bed-calibration';
import type { MissingOuterBand } from '../../../core/camera/target/missing-outer-band';
import {
  shareOutsideTarget,
  targetLayoutMismatch,
} from '../../../core/camera/target/target-coverage';

export function cameraModelFromCalibration(args: {
  readonly calibration: BedCalibration;
  readonly capture: CameraCaptureBinding | null;
  readonly targetHeightMm: number;
  readonly targetArea: BedArea;
  readonly calibratedAt: Date;
  /** The head's bed position at the photo, for a camera on the head (ADR-449). */
  readonly headAtCalibrationMm?: Vec2 | null;
}): CameraModelRecord {
  const { calibration } = args;
  return {
    version: 1,
    lens: calibration.lens,
    pose: calibration.pose,
    ...(args.capture === null ? {} : { capture: args.capture }),
    accuracy: {
      rmsErrorMm: calibration.rmsErrorMm,
      maxErrorMm: calibration.maxErrorMm,
      foundMarks: calibration.foundMarks,
      expectedMarks: calibration.expectedMarks,
      targetHeightMm: args.targetHeightMm,
      targetArea: args.targetArea,
      marks: savedMarkErrors(calibration.markErrors),
    },
    calibratedAt: args.calibratedAt.toISOString(),
    ...(args.headAtCalibrationMm === undefined || args.headAtCalibrationMm === null
      ? {}
      : { mount: { kind: 'head', headAtCalibrationMm: args.headAtCalibrationMm } }),
  };
}

export type CalibrationGrade = {
  readonly tone: 'good' | 'fair' | 'rough';
  readonly headline: string;
  readonly advice: string | null;
};

// Average ring error on the bed. A diode spot is ~0.1–0.2 mm; 0.25 mm is
// below what anyone can see placing artwork by eye, 0.6 mm is still usable
// for rough placement on scrap.
const GOOD_RMS_MM = 0.25;
const FAIR_RMS_MM = 0.6;
// Say that the picture is extrapolated once this share of what the camera
// sees of the bed lies outside the target (a 5 mm margin leaves about 5 %).
const EXTRAPOLATED_SHARE = 0.25;

export function calibrationGrade(record: CameraModelRecord): CalibrationGrade {
  const mismatch = targetLayoutMismatch(record);
  if (mismatch !== null) return mismatchGrade(mismatch, record.mount?.kind === 'head');
  const { rmsErrorMm, foundMarks, expectedMarks } = record.accuracy;
  const coverage = expectedMarks > 0 ? foundMarks / expectedMarks : 0;
  const lowCoverage =
    coverage < 0.6
      ? `Only ${foundMarks} of ${expectedMarks} rings were found, so areas without rings are estimated. Move the laser head out of view and light the bed evenly for a fuller fit.`
      : null;
  const extrapolated = extrapolationAdvice(record);
  if (rmsErrorMm <= GOOD_RMS_MM) {
    return {
      tone: 'good',
      headline: 'Accurate enough for placing artwork by eye.',
      advice: joined(lowCoverage, extrapolated),
    };
  }
  if (rmsErrorMm <= FAIR_RMS_MM) {
    return {
      tone: 'fair',
      headline: 'Good for rough placement.',
      advice: joined(
        lowCoverage ??
          'Check that the camera is in focus and the engraved sheet lies flat, then take the photo again.',
        extrapolated,
      ),
    };
  }
  return {
    tone: 'rough',
    headline: 'The camera and the target disagree by more than half a millimetre.',
    advice:
      'The sheet may have moved after engraving, may not lie flat, or the camera may be out of focus. Fix that and take the photo again.',
  };
}

// The figures are measured on the rings only (ADR-441 Amendment 4): say so
// when much of what the camera sees lies beyond them. No figure is given for
// the rest, because nothing there was measured.
function extrapolationAdvice(record: CameraModelRecord): string | null {
  const share = shareOutsideTarget(record);
  if (share === null || share < EXTRAPOLATED_SHARE) return null;
  const percent = Math.round(share * 100);
  return record.mount?.kind === 'head'
    ? `About ${percent} % of the picture lies outside the target. The accuracy is measured on its rings; elsewhere the picture is estimated. A larger target size measures more of it.`
    : `About ${percent} % of the bed the camera sees lies outside the target. The accuracy is measured on its rings; outside the target the picture is estimated. A smaller margin measures more of the bed.`;
}

function joined(...parts: ReadonlyArray<string | null>): string | null {
  const text = parts.filter((part): part is string => part !== null).join(' ');
  return text === '' ? null : text;
}

function mismatchGrade(band: MissingOuterBand, headCamera: boolean): CalibrationGrade {
  const setting = headCamera ? 'target size' : 'margin';
  return {
    tone: 'rough',
    headline: 'These rings look like a target engraved with other settings.',
    advice:
      `The rings found form a complete ${band.foundCols} × ${band.foundRows} grid, but the layout assumed has ${band.cols} × ${band.rows}, ` +
      `and its missing outer rings lie where the camera sees the bed. A target engraved with another ${setting} or bed size shifts the whole calibration. ` +
      `Under Change settings, enter the ${setting} it was engraved with and take the photo again, or engrave a new target.`,
  };
}

export function calibrationFailureMessage(reason: BedCalibrationFailure['reason']): string {
  switch (reason) {
    case 'no-marks':
      return 'No rings were found in the photo. Check that the camera sees the engraved sheet and the bed is lit.';
    case 'anchors-not-found':
      return 'The three solid discs in the middle of the target were not found. Make sure nothing covers them, including the laser head.';
    case 'target-too-large':
      return 'The target fills the picture from edge to edge, so the rings around its three solid discs may be cut off. Move the camera further from the target or engrave a smaller target (a larger margin, or a smaller target size for a camera on the head), and make sure nothing covers the discs.';
    case 'mirrored-image':
      return 'The camera picture is mirrored. Turn off mirroring or flipping in the camera settings, then take the photo again.';
    case 'too-few-marks':
      return 'Too few rings were found to fit the camera. Light the bed evenly and move anything covering the target.';
    case 'lens-folds':
      return 'The rings cover too little of the picture to model the lens out to its edges. Engrave a larger target (a smaller margin, or a larger target size for a camera on the head), then take the photo again.';
    case 'too-few-points':
    case 'no-initial-pose':
    case 'diverged':
      return 'The rings were found but the camera could not be fitted to them. Check the sheet thickness and camera height, then try again.';
  }
}
