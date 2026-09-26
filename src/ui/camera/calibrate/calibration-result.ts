// Turning a one-photo bed calibration into what the machine profile saves and
// what the wizard says (ADR-441). The accuracy is reported as measured, in
// millimetres on the bed; a rough fit is described, never refused, because the
// operator decides whether it is good enough for their work (ADR-228).

import type { CameraCaptureBinding } from '../../../core/camera/camera-capture-binding';
import type { CameraModelRecord } from '../../../core/camera/model/camera-model-record';
import type {
  BedCalibration,
  BedCalibrationFailure,
} from '../../../core/camera/target/bed-calibration';

export function cameraModelFromCalibration(args: {
  readonly calibration: BedCalibration;
  readonly capture: CameraCaptureBinding | null;
  readonly targetHeightMm: number;
  readonly calibratedAt: Date;
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
    },
    calibratedAt: args.calibratedAt.toISOString(),
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

export function calibrationGrade(record: CameraModelRecord): CalibrationGrade {
  const { rmsErrorMm, foundMarks, expectedMarks } = record.accuracy;
  const coverage = expectedMarks > 0 ? foundMarks / expectedMarks : 0;
  const lowCoverage =
    coverage < 0.6
      ? `Only ${foundMarks} of ${expectedMarks} rings were found, so areas without rings are estimated. Move the laser head out of view and light the bed evenly for a fuller fit.`
      : null;
  if (rmsErrorMm <= GOOD_RMS_MM) {
    return {
      tone: 'good',
      headline: 'Accurate enough for placing artwork by eye.',
      advice: lowCoverage,
    };
  }
  if (rmsErrorMm <= FAIR_RMS_MM) {
    return {
      tone: 'fair',
      headline: 'Good for rough placement.',
      advice:
        lowCoverage ??
        'Check that the camera is in focus and the engraved sheet lies flat, then take the photo again.',
    };
  }
  return {
    tone: 'rough',
    headline: 'The camera and the target disagree by more than half a millimetre.',
    advice:
      'The sheet may have moved after engraving, may not lie flat, or the camera may be out of focus. Fix that and take the photo again.',
  };
}

export function calibrationFailureMessage(reason: BedCalibrationFailure['reason']): string {
  switch (reason) {
    case 'no-marks':
      return 'No rings were found in the photo. Check that the camera sees the engraved sheet and the bed is lit.';
    case 'anchors-not-found':
      return 'The three solid discs in the middle of the target were not found. Make sure nothing covers them, including the laser head.';
    case 'mirrored-image':
      return 'The camera picture is mirrored. Turn off mirroring or flipping in the camera settings, then take the photo again.';
    case 'too-few-marks':
      return 'Too few rings were found to fit the camera. Light the bed evenly and move anything covering the target.';
    case 'too-few-points':
    case 'no-initial-pose':
    case 'diverged':
      return 'The rings were found but the camera could not be fitted to them. Check the sheet thickness and camera height, then try again.';
  }
}
