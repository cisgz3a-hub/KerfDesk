// Perforation (LBG-C01, ADR-415): a Line cut split into dashes of `cutMm`
// separated by uncut gaps of `skipMm`, measured along the path from its start.
//
// Every dash is at most `cutMm` long and every gap at least `skipMm`. On a
// closed contour the pattern stops a full gap short of the start point, so the
// seam never joins the last dash to the first one into a longer cut. A contour
// too short to hold that gap produces no dashes, the same "keep it as one
// bridge" outcome tabs give a shape they would swallow.

import type { Polyline, Vec2 } from '../scene';
import { pathWalk, pointAtDistance } from './path-walk';

export type PerforationPattern = {
  readonly cutMm: number;
  readonly skipMm: number;
};

// Shorter than the emitter's 3-decimal resolution: nothing would be cut.
const MIN_DASH_MM = 0.001;
const EPS = 1e-9;

export function perforatePolylines(
  polylines: ReadonlyArray<Polyline>,
  pattern: PerforationPattern,
): ReadonlyArray<Polyline> {
  return polylines.flatMap((polyline) => perforatePolyline(polyline, pattern));
}

export function perforatePolyline(
  polyline: Polyline,
  pattern: PerforationPattern,
): ReadonlyArray<Polyline> {
  const walk = pathWalk(polyline);
  if (walk === null) return [];
  const endMm = polyline.closed ? walk.lengthMm - pattern.skipMm : walk.lengthMm;
  const periodMm = pattern.cutMm + pattern.skipMm;
  const dashes: Polyline[] = [];
  // Dashes run forward along the path, so the vertex scan resumes where the
  // previous dash stopped instead of restarting at the first point.
  let vertex = 0;
  for (let startMm = 0; startMm < endMm - MIN_DASH_MM; startMm += periodMm) {
    const dashEndMm = Math.min(startMm + pattern.cutMm, endMm);
    if (dashEndMm - startMm < MIN_DASH_MM) continue;
    while (vertex < walk.points.length && (walk.cumulative[vertex] ?? 0) <= startMm + EPS) {
      vertex += 1;
    }
    const points: Vec2[] = [pointAtDistance(walk, startMm)];
    let inner = vertex;
    while (inner < walk.points.length && (walk.cumulative[inner] ?? 0) < dashEndMm - EPS) {
      points.push(walk.points[inner] as Vec2);
      inner += 1;
    }
    points.push(pointAtDistance(walk, dashEndMm));
    dashes.push({ closed: false, points });
  }
  return dashes;
}
