// Checking the saved camera calibration against a new photo of the engraved
// target (ADR-441 Amendment 1). Every photo the wizard measures is also run
// through the calibration already saved, so recalibrating shows how far the
// old one had drifted, and "Check camera" answers "has the camera moved?"
// without replacing anything. The answer describes; saving stays the
// operator's choice (ADR-228).

import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import {
  modelDriftOnMarks,
  type ModelDrift,
  type PhotographedMark,
} from '../../../core/camera/model/model-drift';
import { cameraModelForFrame } from '../camera-model-frame';

export type SavedCalibrationCheck =
  | { readonly kind: 'measured'; readonly drift: ModelDrift; readonly saved: CameraModelRecord }
  | { readonly kind: 'not-comparable'; readonly message: string };

// The saved model counts as unchanged while it is this close to its own
// calibration figure: a new photo of the same rings re-detects them with a
// little noise of its own.
const UNCHANGED_FLOOR_MM = 0.3;
const UNCHANGED_RATIO = 1.5;

export function checkSavedCalibration(args: {
  readonly saved: CameraModelRecord;
  readonly capture: CameraCaptureBinding | null;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly marks: ReadonlyArray<PhotographedMark>;
  readonly targetHeightMm: number;
}): SavedCalibrationCheck {
  const model = cameraModelForFrame(args.saved, args.capture, args.frameWidth, args.frameHeight);
  if (model.kind === 'issue') {
    return {
      kind: 'not-comparable',
      message: `This photo cannot be compared with the saved calibration. ${model.message}`,
    };
  }
  const drift = modelDriftOnMarks(model.lens, model.pose, args.marks, args.targetHeightMm);
  if (drift === null) {
    return {
      kind: 'not-comparable',
      message: 'The saved calibration does not see any of the rings in this photo.',
    };
  }
  return { kind: 'measured', drift, saved: args.saved };
}

export type SavedCalibrationVerdict = {
  readonly moved: boolean;
  readonly headline: string;
  readonly detail: string;
};

export function savedCalibrationVerdict(
  check: Extract<SavedCalibrationCheck, { kind: 'measured' }>,
): SavedCalibrationVerdict {
  const { drift, saved } = check;
  const allowed = Math.max(UNCHANGED_FLOOR_MM, UNCHANGED_RATIO * saved.accuracy.rmsErrorMm);
  const figures = `${drift.rmsMm.toFixed(2)} mm on average, ${drift.maxMm.toFixed(2)} mm at worst, over ${drift.marks} rings`;
  if (drift.rmsMm <= allowed) {
    return {
      moved: false,
      headline: 'The camera has not moved since it was calibrated.',
      detail: `The saved calibration still places the rings within ${figures}.`,
    };
  }
  return {
    moved: true,
    headline: `The saved calibration is off by about ${drift.rmsMm.toFixed(1)} mm.`,
    detail: `It places the rings ${figures} from where they were engraved.${shiftSentence(drift)} Either the camera or its lid has moved, or the target sheet is not where it was engraved. If the sheet has not moved, save the new calibration to correct the overlay.`,
  };
}

function shiftSentence(drift: ModelDrift): string {
  const x = drift.meanDxMm;
  const y = drift.meanDyMm;
  const parts: string[] = [];
  const side = x > 0 ? 'to the right' : 'to the left';
  if (Math.abs(x) >= 0.05) parts.push(`${Math.abs(x).toFixed(1)} mm ${side}`);
  // Bed y grows down the workspace canvas (ADR-440).
  if (Math.abs(y) >= 0.05) parts.push(`${Math.abs(y).toFixed(1)} mm ${y > 0 ? 'lower' : 'higher'}`);
  return parts.length === 0 ? '' : ` On the canvas they appear ${parts.join(' and ')}.`;
}
