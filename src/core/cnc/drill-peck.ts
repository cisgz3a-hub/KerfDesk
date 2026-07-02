// drillPeckPasses — the 'drill' cut type (Phase H.7, F-CNC16). Every closed
// shape on the layer becomes one drilled hole at its bounding-box center,
// pecked: drill down one depth-per-pass step, feed back up to the stock top
// to clear chips, re-enter, and repeat to full depth. GRBL has no canned
// G81/G83 cycles, so the peck is explicit motion — encoded as a path3d pass
// (constant XY, varying Z), which the emitter turns into plunge-feed moves.
// The whole hole cycle runs at the layer's PLUNGE feed (compile pins the
// drill group's cut feed to it): re-entry through the cleared hole is air
// until the previous floor, and fresh material only ever meets the bit at
// plunge feed.

import type { CncPass } from '../job';
import type { Polyline, Vec2 } from '../scene';
import { zPassDepths } from './depth-passes';
import { hasFinitePoints } from './profile-paths';

const MIN_CLOSED_POINTS = 3;
// Chip-clear height: back to the stock top (Z0) between pecks.
const PECK_CLEAR_Z_MM = 0;

export type DrillPeckOptions = {
  readonly depthMm: number;
  readonly depthPerPassMm: number;
};

export function drillPeckPasses(
  polylines: ReadonlyArray<Polyline>,
  options: DrillPeckOptions,
): ReadonlyArray<CncPass> {
  const depths = zPassDepths(options.depthMm, options.depthPerPassMm);
  if (depths.length === 0) return [];
  const passes: CncPass[] = [];
  for (const polyline of polylines) {
    if (!polyline.closed || polyline.points.length < MIN_CLOSED_POINTS) continue;
    if (!hasFinitePoints(polyline)) continue;
    passes.push(peckCycle(boundsCenter(polyline.points), depths));
  }
  return passes;
}

function peckCycle(at: Vec2, depths: ReadonlyArray<number>): CncPass {
  const points = [];
  for (let i = 0; i < depths.length; i += 1) {
    points.push({ x: at.x, y: at.y, z: depths[i] ?? 0 });
    // Clear chips between pecks; the final depth ends the pass (the
    // emitter's next-pass retract lifts the bit).
    if (i < depths.length - 1) {
      points.push({ x: at.x, y: at.y, z: PECK_CLEAR_Z_MM });
    }
  }
  return { kind: 'path3d', points, closed: false };
}

function boundsCenter(points: ReadonlyArray<Vec2>): Vec2 {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}
