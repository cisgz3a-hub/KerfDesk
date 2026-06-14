// polygon — pure geometry for the regular-Polygon drawing primitive (ADR-051,
// Phase G). `sides` vertices evenly spaced on a circle of `radiusMm`
// (circumradius), first vertex pointing up. Centered at (r, r) so the shape
// lives in positive local space; the factory derives bounds from the vertices
// (a polygon's box depends on side count + orientation).

import type { Polyline, Vec2 } from '../scene';

export type PolygonSpec = {
  readonly sides: number; // clamped to [3, 64]
  readonly radiusMm: number; // circumradius
};

const MIN_SIDES = 3;
const MAX_SIDES = 64;
const START_ANGLE_RAD = -Math.PI / 2; // first vertex points up

export function polygonToPolylines(spec: PolygonSpec): ReadonlyArray<Polyline> {
  const sides = clampSides(spec.sides);
  const r = Math.max(0, spec.radiusMm);
  const points: Vec2[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = START_ANGLE_RAD + (2 * Math.PI * i) / sides;
    points.push({ x: r + r * Math.cos(angle), y: r + r * Math.sin(angle) });
  }
  // Repeat the first vertex so the line renderer draws the closing edge (it
  // strokes points as-is and never calls closePath — see shape-to-polylines).
  const first = points[0];
  if (first !== undefined) points.push(first);
  return [{ points, closed: true }];
}

function clampSides(sides: number): number {
  if (!Number.isFinite(sides)) return MIN_SIDES;
  return Math.min(MAX_SIDES, Math.max(MIN_SIDES, Math.floor(sides)));
}
