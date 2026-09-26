// An arc as a GRBL-family controller executes it (ADR-432): mc_arc
// (grbl/motion_control.c, gnea/grbl master) splits it into
// floor(|0.5 x travel x r| / sqrt(tol x (2r - tol))) equal-angle chords, where
// tol is the `$12` arc tolerance, and ends on the programmed target. Timing
// and the painted second pass read G2/G3 through this, so both follow the
// chords the controller really runs.

import type { Vec2 } from '../../scene';

/**
 * The chord points of an arc about `center` from `startRad` through
 * `sweepRad` (signed, negative clockwise), first and last included; at least
 * one chord. Callers replace the last point with the programmed target.
 */
export function controllerArcChordPoints(
  center: Vec2,
  radiusMm: number,
  startRad: number,
  sweepRad: number,
  arcToleranceMm: number,
): Vec2[] {
  const denominator = Math.sqrt(arcToleranceMm * (2 * radiusMm - arcToleranceMm));
  const segments =
    denominator > 0 ? Math.floor(Math.abs(0.5 * sweepRad * radiusMm) / denominator) : 0;
  const count = Math.max(1, segments);
  const points: Vec2[] = [];
  for (let index = 0; index <= count; index += 1) {
    const angle = startRad + (sweepRad * index) / count;
    points.push({
      x: center.x + radiusMm * Math.cos(angle),
      y: center.y + radiusMm * Math.sin(angle),
    });
  }
  return points;
}
