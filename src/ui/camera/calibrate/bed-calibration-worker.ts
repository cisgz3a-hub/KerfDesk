// Runs the one-photo bed calibration off the main thread (ADR-441): ring
// detection and the camera fit take a fraction of a second on a desktop and
// longer on a slow laptop, and the old wizard froze the page for tens of
// seconds solving in place.

import {
  calibrateFromBedTarget,
  type BedCalibrationInput,
} from '../../../core/camera/target/bed-calibration';

type CalibrationRequest = { readonly input: BedCalibrationInput };

self.onmessage = (event: MessageEvent<CalibrationRequest>): void => {
  try {
    self.postMessage({ result: calibrateFromBedTarget(event.data.input) });
  } catch (error: unknown) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
