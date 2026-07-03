// Focal-sweep calibration driver (ADR-107, v2.b follow-on). calibrate() seeds
// the focal at 0.7×imageWidth when the caller has no measured value; measured
// probes show LM then needs thousands of FD iterations to walk the flat
// focal↔distortion valley from a wrong seed, while a near-truth seed settles in
// a few hundred. So for unknown cameras: probe several plausible focal seeds
// briefly, keep the basin with the lowest cost, and polish only that one. The
// audited solver is untouched — this is a deterministic multi-start on top.

import {
  type BoardObservation,
  calibrate,
  type CalibrationOptions,
  type CalibrationResult,
} from './calibrate';

// Focal seeds as fractions of image width: spans real bed-camera hardware from
// wide fisheye (~0.45) to a normal webcam lens (~1.2).
const FOCAL_SWEEP_FRACTIONS: ReadonlyArray<number> = [0.45, 0.55, 0.7, 0.9, 1.2];
// Per-probe iteration budget: enough to rank basins by cost, cheap enough that
// five probes stay interactive. The winner gets the caller's full budget.
const PROBE_ITERATIONS = 120;

/**
 * Calibrate with a focal multi-start when the caller cannot supply a measured
 * focal seed. With `options.initialGuess.fx`/`fy` present this is exactly one
 * calibrate() call — the caller's knowledge beats the sweep.
 */
export function calibrateWithFocalSweep(
  views: ReadonlyArray<BoardObservation>,
  options?: CalibrationOptions,
): CalibrationResult {
  const guess = options?.initialGuess;
  if (guess === undefined || guess.fx !== undefined || guess.fy !== undefined) {
    return calibrate(views, options);
  }
  let bestSeedFx: number | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const fraction of FOCAL_SWEEP_FRACTIONS) {
    const fx = fraction * guess.imageWidth;
    const probe = calibrate(views, {
      ...options,
      initialGuess: { ...guess, fx, fy: fx },
      maxIterations: PROBE_ITERATIONS,
    });
    if (probe.kind !== 'ok') continue;
    // Rank basins by the probe's reprojection RMS (a per-corner cost).
    if (probe.rmsPx < bestCost) {
      bestCost = probe.rmsPx;
      bestSeedFx = fx;
    }
  }
  if (bestSeedFx === null) return calibrate(views, options);
  return calibrate(views, {
    ...options,
    initialGuess: { ...guess, fx: bestSeedFx, fy: bestSeedFx },
  });
}
