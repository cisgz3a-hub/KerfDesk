// Arc interpolation the way a GRBL-family controller executes it (ADR-407),
// for timing: mc_arc (grbl/motion_control.c, gnea/grbl master) splits an arc
// into floor(|0.5 x travel x r| / sqrt(tol x (2r - tol))) equal-angle chords,
// where tol is the `$12` arc tolerance, and ends on the programmed target. The
// planner then sees each chord as one block, so its junction speeds, not the
// coarser display sampling, decide how fast an arc runs.

import { GRBL_STOCK_ARC_TOLERANCE_MM } from '../geometry/arc-fit';
import type { Vec2 } from '../scene';

/** Stock `$12` arc tolerance (DEFAULT_ARC_TOLERANCE, grbl/defaults.h). */
export const GRBL_DEFAULT_ARC_TOLERANCE_MM = GRBL_STOCK_ARC_TOLERANCE_MM;

export function controllerArcPoints(
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
