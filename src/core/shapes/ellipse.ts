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

const ELLIPSE_TOLERANCE_MM = 0.05;
const MIN_SEGMENTS = 24;
const MAX_SEGMENTS = 512;

export function ellipseToPolylines(spec: EllipseSpec): ReadonlyArray<Polyline> {
  const a = Math.max(0, spec.widthMm) / 2;
  const b = Math.max(0, spec.heightMm) / 2;
  const segments = segmentCount(Math.max(a, b));
  const points: Vec2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (2 * Math.PI * i) / segments;
    points.push({ x: a + a * Math.cos(t), y: b + b * Math.sin(t) });
  }
  return [{ points, closed: true }];
}

// Chord-tolerance segment count for a circle of radius r: keeping the sagitta
// r(1 - cos(theta/2)) under tol gives theta ~= 2*sqrt(2*tol/r), so the count is
// ceil(pi * sqrt(r / (2*tol))). Clamped to a sane interactive range.
function segmentCount(maxRadius: number): number {
  if (maxRadius <= 0) return MIN_SEGMENTS;
  const n = Math.ceil(Math.PI * Math.sqrt(maxRadius / (2 * ELLIPSE_TOLERANCE_MM)));
  return Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, n));
}
