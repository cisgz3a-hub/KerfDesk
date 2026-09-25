// Arc interpolation the way a GRBL-family controller executes it (ADR-407),
// for timing: the planner sees each mc_arc chord as one block, so its junction
// speeds, not the coarser display sampling, decide how fast an arc runs.

import { sampleArcPoints } from '../geometry';
import { controllerArcChordPoints, GRBL_STOCK_ARC_TOLERANCE_MM } from '../geometry/arc-fit';
import { DEFAULT_MACHINE_CURVE_TOLERANCE_MM, type Vec2 } from '../scene';

/** Stock `$12` arc tolerance (DEFAULT_ARC_TOLERANCE, grbl/defaults.h). */
export const GRBL_DEFAULT_ARC_TOLERANCE_MM = GRBL_STOCK_ARC_TOLERANCE_MM;

export const controllerArcPoints = controllerArcChordPoints;

/**
 * What one controller-interpolated arc counts against a segment budget: the
 * chords the G1 program it replaces would spend on it, at the machine curve
 * tolerance. mc_arc's chords are about 3.5 times denser than those, so
 * counting them one by one would push a job that fits the budget as G1 out of
 * it merely for being written with arcs.
 */
export function controllerArcBudgetSegments(radiusMm: number, sweepRad: number): number {
  const ratio = 1 - DEFAULT_MACHINE_CURVE_TOLERANCE_MM / radiusMm;
  if (!(ratio > -1)) return 1;
  const step = 2 * Math.acos(Math.min(1, ratio));
  return step > 0 ? Math.max(1, Math.ceil(Math.abs(sweepRad) / step)) : 1;
}

/**
 * The points a parsed G2/G3 is drawn and timed through: the display's
 * sampling, or with a controller `$12` the chords mc_arc runs, together with
 * how many of those chords the segment budget leaves uncounted.
 */
export function timingArcPoints(
  center: Vec2,
  radiusMm: number,
  startRad: number,
  sweepRad: number,
  controllerArcToleranceMm: number | undefined,
): { readonly points: Vec2[]; readonly budgetRelief: number } {
  if (controllerArcToleranceMm === undefined) {
    return { points: sampleArcPoints(center, radiusMm, startRad, sweepRad), budgetRelief: 0 };
  }
  const points = controllerArcPoints(
    center,
    radiusMm,
    startRad,
    sweepRad,
    controllerArcToleranceMm,
  );
  const counted = controllerArcBudgetSegments(radiusMm, sweepRad);
  return { points, budgetRelief: Math.max(0, points.length - 1 - counted) };
}
