// Exact affine images of canonical curves (ADR-403).
//
// Lines and cubics map by their points. An elliptical arc maps to another
// elliptical arc: with A = L · R(phi) · diag(rx, ry) (L the linear part of the
// matrix), the image ellipse's radii are A's singular values and its axis
// angle is the rotation of A's left singular basis. Endpoint arc flags stay
// valid because the SVG radius-correction ratio is measured in the ellipse's
// unit-circle frame, which an affine map only rotates. A reflection
// (det L < 0) reverses the sweep direction.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import { curveSubpathBounds } from '../scene/curve-path';
import type {
  Bounds,
  CurveSubpath,
  EllipticalArcPathSegment,
  PathSegment,
  Vec2,
} from '../scene/scene-object';

export type AffineMatrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export const IDENTITY_AFFINE: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function applyAffine(m: AffineMatrix, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** `outer ∘ inner`: apply `inner` first. */
export function composeAffine(outer: AffineMatrix, inner: AffineMatrix): AffineMatrix {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/** Largest singular value of the linear part: the matrix's worst-case length gain. */
export function affineMaxGain(m: AffineMatrix): number {
  return singularValues(m.a, m.c, m.b, m.d).major;
}

export function transformCurveSubpathExact(path: CurveSubpath, m: AffineMatrix): CurveSubpath {
  return {
    start: applyAffine(m, path.start),
    segments: path.segments.map((segment) => transformSegment(segment, m)),
    closed: path.closed,
  };
}

/** Exact axis-aligned bounds (derivative roots for cubics, axis extrema for arcs). */
export function curvesBounds(curves: ReadonlyArray<CurveSubpath>): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const curve of curves) {
    const b = curveSubpathBounds(curve);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return Number.isFinite(minX) && Number.isFinite(maxX) ? { minX, minY, maxX, maxY } : null;
}

function transformSegment(segment: PathSegment, m: AffineMatrix): PathSegment {
  if (segment.kind === 'line') return { kind: 'line', to: applyAffine(m, segment.to) };
  if (segment.kind === 'cubic') {
    return {
      kind: 'cubic',
      control1: applyAffine(m, segment.control1),
      control2: applyAffine(m, segment.control2),
      to: applyAffine(m, segment.to),
    };
  }
  return transformArc(segment, m);
}

function transformArc(segment: EllipticalArcPathSegment, m: AffineMatrix): PathSegment {
  const to = applyAffine(m, segment.to);
  const rx = Math.abs(segment.radiusX);
  const ry = Math.abs(segment.radiusY);
  // SVG treats a zero radius as a straight line; keep that meaning.
  if (!(rx > 0) || !(ry > 0)) return { kind: 'line', to };
  const phi = (segment.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // A = L · R(phi) · diag(rx, ry), rows [[p, q], [r, s]].
  const p = (m.a * cos + m.c * sin) * rx;
  const q = (-m.a * sin + m.c * cos) * ry;
  const r = (m.b * cos + m.d * sin) * rx;
  const s = (-m.b * sin + m.d * cos) * ry;
  const svd = singularValues(p, q, r, s);
  if (!(svd.minor > 0)) return { kind: 'line', to };
  const determinant = m.a * m.d - m.b * m.c;
  return {
    kind: 'elliptical-arc',
    radiusX: svd.major,
    radiusY: svd.minor,
    rotationDeg: (svd.majorAngle * 180) / Math.PI,
    largeArc: segment.largeArc,
    sweep: determinant < 0 ? !segment.sweep : segment.sweep,
    to,
  };
}

/**
 * Singular values of the 2×2 matrix [[p, q], [r, s]] and the angle of the
 * major left-singular vector, via the closed-form rotation–scale–rotation
 * decomposition.
 */
function singularValues(
  p: number,
  q: number,
  r: number,
  s: number,
): { readonly major: number; readonly minor: number; readonly majorAngle: number } {
  const e = (p + s) / 2;
  const f = (p - s) / 2;
  const g = (r + q) / 2;
  const h = (r - q) / 2;
  const qq = Math.hypot(e, h);
  const rr = Math.hypot(f, g);
  const a1 = Math.atan2(g, f);
  const a2 = Math.atan2(h, e);
  return { major: qq + rr, minor: Math.abs(qq - rr), majorAngle: (a2 + a1) / 2 };
}
