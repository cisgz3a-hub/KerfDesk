// orderInnerFirst — sort profile toolpaths so inner contours cut before the
// outer contours that contain them.
//
// Cutting a hole after freeing the part that contains it machines a workpiece
// that can move. Ordering by containment depth (innermost first) keeps a part
// fully machined before the cut that could let it move. Shared by the roughing
// and finishing passes so both walk the shapes in the same safe order.

import type { Polyline, Vec2 } from '../scene';

const MIN_CLOSED_POINTS = 3;

export function orderInnerFirst(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  const closedPolylines = polylines.filter(
    (polyline) => polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS,
  );
  return polylines
    .map((polyline, index) => ({
      polyline,
      index,
      depth: containmentDepth(polyline, closedPolylines),
    }))
    .sort((a, b) => b.depth - a.depth || a.index - b.index)
    .map((entry) => entry.polyline);
}

function containmentDepth(polyline: Polyline, closed: ReadonlyArray<Polyline>): number {
  const probe = polyline.points[0];
  if (probe === undefined) return 0;
  let depth = 0;
  for (const candidate of closed) {
    if (candidate === polyline) continue;
    if (pointInPolygon(probe, candidate.points)) depth += 1;
  }
  return depth;
}

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const crossesY = a.y > point.y !== b.y > point.y;
    if (!crossesY) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}
