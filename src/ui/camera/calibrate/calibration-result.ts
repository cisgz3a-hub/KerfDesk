// Turning a one-photo bed calibration into what the machine profile saves and
// what the wizard says (ADR-441). The accuracy is reported as measured, in
// millimetres on the bed; a rough fit is described, never refused, because the
// operator decides whether it is good enough for their work (ADR-228).

import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import type { CameraBedFrame } from '../../../core/camera/model/camera-bed-frame';
import { savedMarkErrors, type BedArea } from '../../../core/camera/model/camera-model-accuracy';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type { Vec2 } from '../../../core/scene';
import type {
  BedCalibration,
  BedCalibrationFailure,
} from '../../../core/camera/target/bed-calibration';
import { DEFAULT_RING_DIAMETER_MM } from '../../../core/camera/target/bed-target';
import {
  extrapolationEstimate,
  GOOD_EXTRAPOLATED_MM,
  type ExtrapolationEstimate,
} from '../../../core/camera/model/extrapolation-estimate';
import type { MissingOuterBand } from '../../../core/camera/target/missing-outer-band';
import {
  shareOutsideTarget,
  targetLayoutMismatch,
} from '../../../core/camera/target/target-coverage';
import { roundToTenth } from '../../../core/util/rounding';

export function cameraModelFromCalibration(args: {
  readonly calibration: BedCalibration;
  readonly capture: CameraCaptureBinding | null;
  readonly targetHeightMm: number;
  readonly targetArea: BedArea;
  /** Outer diameter of the target's rings, mm. */
  readonly targetRingDiameterMm?: number;
  readonly calibratedAt: Date;
  /** The head's bed position at the photo, for a camera on the head (ADR-449). */
  readonly headAtCalibrationMm?: Vec2 | null;
  /** The head's machine Z at the photo (ADR-449 Amendment 2); null or absent when unknown. */
  readonly headZAtCalibrationMm?: number | null | undefined;
  /** The bed frame the target's rings were placed in (rolling audit 12-P2-2). */
  readonly bedFrame?: CameraBedFrame;
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
      ...(args.targetRingDiameterMm === undefined ||
      args.targetRingDiameterMm === DEFAULT_RING_DIAMETER_MM
        ? {}
        : { targetRingDiameterMm: args.targetRingDiameterMm }),
      marks: savedMarkErrors(calibration.markErrors),
      ...(heightLeftLoose(calibration) ? { onlyAtTargetHeight: true as const } : {}),
    },
    calibratedAt: args.calibratedAt.toISOString(),
    ...headMount(args.headAtCalibrationMm, args.headZAtCalibrationMm),
    ...(args.bedFrame === undefined ? {} : { bedFrame: args.bedFrame }),
  };
}

function headMount(
  head: Vec2 | null | undefined,
  z: number | null | undefined,
): Pick<CameraModelRecord, 'mount'> {
  if (head === undefined || head === null) return {};
  return {
    mount: {
      kind: 'head',
      headAtCalibrationMm: head,
      ...(z === undefined || z === null ? {} : { headZAtCalibrationMm: z }),
    },
  };
}

// Above this the photo alone leaves the camera height loose enough to shift
// material of another thickness by a visible amount (ADR-440).
export const LOOSE_HEIGHT_SIGMA_MM = 10;

function heightLeftLoose(calibration: BedCalibration): boolean {
  return !calibration.heightMeasured && calibration.cameraHeightSigmaMm > LOOSE_HEIGHT_SIGMA_MM;
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
  // The rings fit at their own height whatever the camera height, so their
  // figures look perfect while thicker or thinner material is millimetres off
  // (measured: 0.07 mm on the rings, 9 mm at 25 mm material).
  if (record.accuracy.onlyAtTargetHeight === true && rmsErrorMm <= FAIR_RMS_MM) {
    return {
      tone: 'fair',
      headline: `Lined up at the height of the ${roundToTenth(record.accuracy.targetHeightMm)} mm target sheet only.`,
      advice: joined(
        'The camera looks almost straight down, so one photo cannot tell how high it is. On the target sheet the picture is exact, but on thicker or thinner material it may be off by several millimetres. Measure the height of the camera lens above the bed, enter it under Change settings (Camera height), and take the photo again.',
        lowCoverage,
        extrapolated,
      ),
    };
  }
  if (rmsErrorMm <= GOOD_RMS_MM) return goodOnTheRings(record, joined(lowCoverage, extrapolated));
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

// Rolling audit v13 Y1-P2-1: the rings read 0.06 mm while the far bed was
// millimetres off, and the grade said "Accurate enough" for all of it. Good
// now means the whole bed the camera sees (ADR-441 Amendment 9).
function goodOnTheRings(record: CameraModelRecord, advice: string | null): CalibrationGrade {
  const offTarget = offTargetEstimate(record);
  if (offTarget !== null && offTarget.worstMm > GOOD_EXTRAPOLATED_MM) {
    return {
      tone: 'fair',
      headline: `Accurate on the target; elsewhere on the bed up to about ${roundToTenth(offTarget.worstMm)} mm off.`,
      advice,
    };
  }
  return { tone: 'good', headline: 'Accurate enough for placing artwork by eye.', advice };
}

// The figures are measured on the rings only (ADR-441 Amendment 4): say so
// when much of what the camera sees lies beyond them, with the estimate of
// how far off it may be there (Amendment 9). The lever is the sheet: a
// larger one measures more of the bed (a smaller margin adds only a few
// millimetres, rolling audit v13 Y1-P3-6).
function extrapolationAdvice(record: CameraModelRecord): string | null {
  const share = shareOutsideTarget(record);
  const offTarget = offTargetEstimate(record);
  const large = offTarget !== null && offTarget.worstMm > GOOD_EXTRAPOLATED_MM;
  if ((share === null || share < EXTRAPOLATED_SHARE) && !large) return null;
  if (record.mount?.kind === 'head') {
    return `About ${Math.round((share ?? 0) * 100)} % of the picture lies outside the target. The accuracy is measured on its rings; elsewhere the picture is estimated. A larger target size measures more of it.`;
  }
  const outside = outsideSentence(share);
  const estimate =
    offTarget === null
      ? 'outside the target the picture is estimated.'
      : `outside the target the picture is estimated, and may be up to about ${roundToTenth(offTarget.worstMm)} mm off ${bedRegion(offTarget)}.`;
  const fix = large
    ? ' Engrave the target on a larger sheet, one that covers more of the bed the camera sees, to measure more of it.'
    : '';
  return `${outside} The accuracy is measured on its rings; ${estimate}${fix}`;
}

function outsideSentence(share: number | null): string {
  return share === null || share < EXTRAPOLATED_SHARE
    ? 'Part of the bed the camera sees lies outside the target.'
    : `About ${Math.round(share * 100)} % of the bed the camera sees lies outside the target.`;
}

// The off-target estimate for a fixed camera, or null when it cannot be made.
function offTargetEstimate(record: CameraModelRecord): ExtrapolationEstimate | null {
  return record.mount?.kind === 'head' ? null : extrapolationEstimate(record);
}

/** Where on the bed the estimate is worst, as the canvas shows it (y grows down). */
export function bedRegion(estimate: Pick<ExtrapolationEstimate, 'worstAt' | 'bed'>): string {
  const { worstAt: at, bed } = estimate;
  const across = at.x < bed.width / 3 ? 'left' : at.x > (2 * bed.width) / 3 ? 'right' : null;
  const down = at.y < bed.height / 3 ? 'top' : at.y > (2 * bed.height) / 3 ? 'bottom' : null;
  if (across !== null && down !== null) return `near the ${down}-${across} corner of the bed`;
  if (across !== null || down !== null) return `near the ${down ?? across} edge of the bed`;
  return 'in the middle of the bed';
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

// A ring size that puts the median ring at this many pixels, with room above
// the detector's limit (MIN_RING_DIAMETER_PX).
const SUGGESTED_RING_PX = 12;
// Rings larger than this crowd a normal bed with too few of them.
const LARGEST_SUGGESTED_RING_MM = 25;

/** What to do when the rings are too small in the picture, with the ring size to use. */
export function ringsTooSmallMessage(ringDiameterPx: number, ringDiameterMm: number): string {
  const seen = `The rings are only about ${Math.round(ringDiameterPx)} pixels across in the photo, too small to find reliably.`;
  const suggested = Math.ceil((ringDiameterMm * SUGGESTED_RING_PX) / Math.max(ringDiameterPx, 1));
  if (suggested > LARGEST_SUGGESTED_RING_MM) {
    return `${seen} Set the camera to a larger picture size or move it closer to the bed, then engrave a new target.`;
  }
  return `${seen} Engrave a new target with ${suggested} mm rings (Engrave settings, Ring size), or set the camera to a larger picture size.`;
}

export function calibrationFailureMessage(
  reason: Exclude<BedCalibrationFailure['reason'], 'rings-too-small'>,
): string {
  switch (reason) {
    case 'no-marks':
      return 'No rings were found in the photo. Check that the camera sees the engraved sheet and the bed is lit. If each ring is only a few pixels across, set the camera to a larger picture size or engrave larger rings (Engrave settings, Ring size).';
    case 'anchors-not-found':
      return 'The three solid discs in the middle of the target were not found. Make sure nothing covers them, including the laser head.';
    case 'target-too-large':
      return 'The target fills the picture from edge to edge, so the rings around its three solid discs may be cut off. Move the camera further from the target or engrave a smaller target (a larger margin, or a smaller target size for a camera on the head), and make sure nothing covers the discs.';
    case 'anchors-unclear':
      return 'Some rings look like solid discs in the photo, so KerfDesk cannot tell which three discs mark the middle of the target. Light the bed evenly, set the camera to a larger picture size or move it closer, and if the rings are burned nearly solid, engrave a new target with less power. Old marks next to the target can also cause this.';
    case 'mirrored-image':
      return 'The camera picture is mirrored. Turn off mirroring or flipping in the camera settings, then take the photo again.';
    case 'too-few-marks':
      return 'Too few rings were found to fit the camera. Light the bed evenly and move anything covering the target.';
    case 'lens-folds':
      return 'The rings cover too little of the picture to model the lens out to its edges. Engrave a larger target (on a larger sheet, or a larger target size for a camera on the head), then take the photo again.';
    case 'too-few-points':
    case 'no-initial-pose':
    case 'diverged':
      return 'The rings were found but the camera could not be fitted to them. Check the sheet thickness and camera height, then try again.';
  }
}
