// orderInnerFirst — group profile toolpaths into parts and machine each part
// completely (inner contours first, then the outer that contains them) before
// travelling to the next part.
//
// Cutting a hole after freeing the part that contains it machines a workpiece
// that can move, so inner contours stay ahead of their own outer. Ordering
// the whole layer by containment depth alone (the pre-ADR-276 behavior) kept
// that safety property but cut every hole across the scene before any outer:
// a two-word text job visited three letters' counters, then returned to the
// first letter (the Drive/Safe field incident, 2026-08-01). Parts now follow
// the order their outermost contours appear in the input — the same
// source-order rule vcarveRegionOrder uses (ADR-270) — and the roughing and
// finishing passes share this module so both walk the shapes identically.

import { pointInPolygon } from '../geometry';
import type { Polyline } from '../scene';

const MIN_CLOSED_POINTS = 3;

type OrderedContour = {
  readonly polyline: Polyline;
  readonly index: number;
  readonly depth: number;
};

export function orderInnerFirst(polylines: ReadonlyArray<Polyline>): ReadonlyArray<Polyline> {
  const closedPolylines = polylines.filter(
    (polyline) => polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS,
  );
  const contours = polylines.map((polyline, index) => ({
    polyline,
    index,
    depth: containmentDepth(polyline, closedPolylines),
  }));
  const roots = contours.filter(
    (contour) =>
      contour.depth === 0 &&
      contour.polyline.closed &&
      contour.polyline.points.length >= MIN_CLOSED_POINTS,
  );
  const parts = new Map<number, OrderedContour[]>();
  for (const contour of contours) {
    const key = owningRootIndex(contour, roots);
    const part = parts.get(key);
    if (part === undefined) parts.set(key, [contour]);
    else part.push(contour);
  }
  return [...parts.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([, part]) =>
      part
        .sort((a, b) => b.depth - a.depth || a.index - b.index)
        .map((contour) => contour.polyline),
    );
}

// The part a nested contour belongs to is the first top-level contour that
// contains its probe point; top-level contours — and anything no top-level
// contour contains — own themselves. Well-formed nesting gives exactly one
// containing root; overlapping outers are degenerate input, where first-in-
// input-order keeps the result deterministic.
function owningRootIndex(contour: OrderedContour, roots: ReadonlyArray<OrderedContour>): number {
  if (contour.depth === 0) return contour.index;
  const probe = contour.polyline.points[0];
  if (probe === undefined) return contour.index;
  for (const root of roots) {
    if (pointInPolygon(probe, root.polyline.points)) return root.index;
  }
  return contour.index;
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
