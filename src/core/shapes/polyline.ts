// polyline — pass-through geometry for the pen tool's open/closed point list
// (ADR-051, Phase G, B6). Unlike rect/ellipse/polygon, the points ARE the
// geometry, so this just wraps them in a single Polyline carrying the `closed`
// flag (a closed polyline hatches under Fill mode; an open one only strokes).
// Pure; an empty point list materializes to no polyline.

import type { Polyline, Vec2 } from '../scene';

export type PolylineSpec = {
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
};

export function polylineToPolylines(spec: PolylineSpec): ReadonlyArray<Polyline> {
  if (spec.points.length === 0) return [];
  // A closed pen polyline repeats its first vertex so the line renderer draws
  // the closing edge (it strokes points as-is and never calls closePath — the
  // same convention as rect/ellipse/polygon and io/svg/shape-to-polylines).
  if (spec.closed) {
    const first = spec.points[0];
    if (first !== undefined) return [{ points: [...spec.points, first], closed: true }];
  }
  return [{ points: spec.points, closed: spec.closed }];
}
