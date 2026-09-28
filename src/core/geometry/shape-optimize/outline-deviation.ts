// How far an outline moved (Optimize Shapes, LBG-T22): the larger of the
// farthest any point of the old outline lies from the new one and the farthest
// any point of the new one lies from the old, both as polylines in world
// millimetres, each side's nearest edges found through a grid (edge-grid.ts).
//
// Every vertex is measured first. Along an edge the distance to the other
// outline changes no faster than the position does, so an edge whose ends are
// d_a and d_b away and which is L long gets no farther than (d_a + d_b + L) / 2
// anywhere; an edge that could still beat the farthest distance found so far
// is halved and its middle measured, down to pieces RESOLUTION_MM long. The
// answer is exact at the measured points and at most RESOLUTION_MM / 2 short
// of the true farthest distance.

import type { Vec2 } from '../../scene/scene-object';
import { edgeGrid, nearestEdgeDistance as nearest, type EdgeGrid } from './edge-grid';

const RESOLUTION_MM = 0.005;

export function outlineDeviationMm(
  before: ReadonlyArray<Vec2>,
  beforeClosed: boolean,
  after: ReadonlyArray<Vec2>,
  afterClosed: boolean,
): number {
  if (before.length === 0 || after.length === 0) return 0;
  const toAfter = edgeGrid(after, afterClosed);
  const toBefore = edgeGrid(before, beforeClosed);
  const beforeDistances = vertexDistances(before, toAfter);
  const afterDistances = vertexDistances(after, toBefore);
  let worst = Math.max(maxOf(beforeDistances), maxOf(afterDistances));
  worst = edgeDeviation(before, beforeClosed, beforeDistances, toAfter, worst);
  return edgeDeviation(after, afterClosed, afterDistances, toBefore, worst);
}

function vertexDistances(points: ReadonlyArray<Vec2>, grid: EdgeGrid): Float64Array {
  const distances = new Float64Array(points.length);
  for (let k = 0; k < points.length; k += 1) {
    const point = points[k] as Vec2;
    distances[k] = nearest(grid, point.x, point.y);
  }
  return distances;
}

function maxOf(values: Float64Array): number {
  let worst = 0;
  for (const value of values) if (value > worst) worst = value;
  return worst;
}

// The farthest any edge's points lie from the other outline, at least `worst`.
function edgeDeviation(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  distances: Float64Array,
  grid: EdgeGrid,
  worst: number,
): number {
  let farthest = worst;
  const edges = closed ? points.length : points.length - 1;
  for (let edge = 0; edge < edges; edge += 1) {
    const next = (edge + 1) % points.length;
    const a = points[edge] as Vec2;
    const b = points[next] as Vec2;
    farthest = Math.max(
      farthest,
      edgeFarthest(grid, a, b, distances[edge] as number, distances[next] as number, farthest),
    );
  }
  return farthest;
}

function edgeFarthest(
  grid: EdgeGrid,
  a: Vec2,
  b: Vec2,
  da: number,
  db: number,
  worst: number,
): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if ((da + db + length) / 2 <= worst || length <= RESOLUTION_MM) return worst;
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dm = nearest(grid, middle.x, middle.y);
  const left = edgeFarthest(grid, a, middle, da, dm, Math.max(worst, dm));
  return edgeFarthest(grid, middle, b, dm, db, left);
}
