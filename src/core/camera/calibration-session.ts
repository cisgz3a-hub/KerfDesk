// Calibration capture session (ADR-095, v2.e) — the pure state machine the wizard
// renders. It accumulates board captures, runs the solver once enough are collected,
// and folds in the trust and pose-diversity assessments so the UI stays a thin
// renderer of a discriminated-union state. Pure core: no I/O, deterministic.

import {
  type BoardObservation,
  calibrate,
  type CalibrationFailure,
  type CalibrationOptions,
  type CalibrationResult,
} from './calibrate';
import { assessCalibrationTrust, type TrustVerdict } from './calibration-trust';
import { checkPoseDiversity, type PoseDiversityVerdict } from './pose-diversity';

type SolvedCalibration = Extract<CalibrationResult, { readonly kind: 'ok' }>;

/** Minimum board captures before the wizard offers to solve (ADR-095: ~5 poses). */
export const MIN_CALIBRATION_VIEWS = 5;

export type CalibrationSession =
  | { readonly kind: 'collecting'; readonly captures: ReadonlyArray<BoardObservation> }
  | {
      readonly kind: 'solved';
      readonly captures: ReadonlyArray<BoardObservation>;
      readonly result: SolvedCalibration;
      readonly trust: TrustVerdict;
      readonly diversity: PoseDiversityVerdict;
    }
  | {
      readonly kind: 'failed';
      readonly captures: ReadonlyArray<BoardObservation>;
      readonly reason: CalibrationFailure;
    };

/** A fresh session with no captures. */
export function emptySession(): CalibrationSession {
  return { kind: 'collecting', captures: [] };
}

/** Append a board capture, returning to the collecting state (re-solve afterwards). */
export function addCapture(
  session: CalibrationSession,
  capture: BoardObservation,
): CalibrationSession {
  return { kind: 'collecting', captures: [...session.captures, capture] };
}

/** Whether enough captures have been collected to attempt a solve. */
export function canSolve(session: CalibrationSession): boolean {
  return session.captures.length >= MIN_CALIBRATION_VIEWS;
}

/** Solve the collected captures and attach the trust + pose-diversity verdicts. */
export function solveSession(
  session: CalibrationSession,
  options?: CalibrationOptions,
): CalibrationSession {
  const result = calibrate(session.captures, options);
  if (result.kind !== 'ok') {
    return { kind: 'failed', captures: session.captures, reason: result.reason };
  }
  const trust = assessCalibrationTrust({
    intrinsics: result.intrinsics,
    distortion: result.distortion,
    imageWidth: result.imageWidth,
    imageHeight: result.imageHeight,
    rmsPx: result.rmsPx,
    coverage: result.coverage,
  });
  const diversity = checkPoseDiversity(result.views);
  return { kind: 'solved', captures: session.captures, result, trust, diversity };
}
