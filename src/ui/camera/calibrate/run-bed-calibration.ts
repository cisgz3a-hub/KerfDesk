// Starts the bed calibration in its own worker and hands back the result
// (ADR-441). One worker per run, terminated when it answers or the wizard
// abandons the run, so a closed wizard never leaves a solve running. Where
// workers are unavailable (unit tests) it solves in place.

import {
  calibrateFromBedTarget,
  type BedCalibration,
  type BedCalibrationFailure,
  type BedCalibrationInput,
} from '../../../core/camera/target/bed-calibration';

export type BedCalibrationOutcome = BedCalibration | BedCalibrationFailure;

type WorkerReply = { readonly result?: BedCalibrationOutcome; readonly error?: string };

export function runBedCalibration(
  input: BedCalibrationInput,
  signal?: AbortSignal,
): Promise<BedCalibrationOutcome> {
  if (typeof Worker === 'undefined') return Promise.resolve(calibrateFromBedTarget(input));
  const worker = new Worker(new URL('./bed-calibration-worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise<BedCalibrationOutcome>((resolve, reject) => {
    const abort = (): void => reject(new Error('Calibration cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      if (event.data.result !== undefined) resolve(event.data.result);
      else reject(new Error(event.data.error ?? 'Calibration failed.'));
    };
    worker.onerror = () => reject(new Error('The calibration worker stopped.'));
    worker.onmessageerror = () => reject(new Error('The calibration result could not be read.'));
    worker.postMessage({ input });
  }).finally(() => worker.terminate());
}
