// ellipse — pure geometry for the Ellipse drawing primitive (ADR-051, Phase G).
// Produces the outline as a single closed polyline inscribed in the local box
// [0,width] x [0,height] (so an ellipse and a rectangle of the same spec share
// bounds). Segment count is adaptive: it scales with the larger radius to keep
// the chord-height facet under ELLIPSE_TOLERANCE_MM at any laser scale.

import type { Polyline, Vec2 } from '../scene';

export type EllipseSpec = {
  readonly widthMm: number;
  readonly heightMm: number;
};

export const ELLIPSE_TOLERANCE_MM = 0.05;
export const ELLIPSE_MIN_SEGMENTS = 24;
export const ELLIPSE_MAX_SEGMENTS = 512;

export function ellipseToPolylines(spec: EllipseSpec): ReadonlyArray<Polyline> {
  const a = Math.max(0, spec.widthMm) / 2;
  const b = Math.max(0, spec.heightMm) / 2;
  const segments = ellipseSegmentCount(Math.max(a, b));
  const points: Vec2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (2 * Math.PI * i) / segments;
    points.push({ x: a + a * Math.cos(t), y: b + b * Math.sin(t) });
  }
  // Repeat the first point so the line renderer draws the closing segment (it
  // strokes points as-is and never calls closePath — see shape-to-polylines).
  const first = points[0];
  if (first !== undefined) points.push(first);
  return [{ points, closed: true }];
}

// Chord-tolerance segment count for a circle of radius r: keeping the sagitta
// r(1 - cos(theta/2)) under tol gives theta ~= 2*sqrt(2*tol/r), so the count is
// ceil(pi * sqrt(r / (2*tol))). Clamped to a sane interactive range.
export function ellipseSegmentCount(maxRadius: number): number {
  if (maxRadius <= 0) return ELLIPSE_MIN_SEGMENTS;
  const n = Math.ceil(Math.PI * Math.sqrt(maxRadius / (2 * ELLIPSE_TOLERANCE_MM)));
  return Math.min(ELLIPSE_MAX_SEGMENTS, Math.max(ELLIPSE_MIN_SEGMENTS, n));
}
