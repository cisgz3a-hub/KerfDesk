// Exact affine images of canonical curves (ADR-431).
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

import {
  curveSubpathBounds,
  endpointArc,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  MAX_FLATTENED_CURVE_SEGMENTS,
  type FlattenCurveOptions,
  type FlattenCurveResult,
} from '../scene/curve-path';
import { flattenCubicChords, flattenEllipseChords } from '../scene/curve-flatten';
import type {
  Bounds,
  CurveSubpath,
  EllipticalArcPathSegment,
  PathSegment,
  Vec2,
} from '../scene/scene-object';
import {
  artworkArcExtrema,
  artworkArcParameters,
  artworkArcPoint,
  artworkArcReconstructionError,
  flattenArtworkArc,
  retainedArtworkArc,
  retainArtworkArc,
  type ArtworkParametricArc,
} from './artwork-parametric-arc';

export type AffineMatrix = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

export function applyAffine(m: AffineMatrix, p: Vec2): Vec2 {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** Largest singular value of the linear part: the matrix's worst-case length gain. */
export function affineMaxGain(m: AffineMatrix): number {
  return singularValues(m.a, m.c, m.b, m.d).major;
}

export function transformCurveSubpathExact(path: CurveSubpath, m: AffineMatrix): CurveSubpath {
  const segments: PathSegment[] = [];
  let from = path.start;
  for (const segment of path.segments) {
    segments.push(...transformSegment(from, segment, m));
    from = segment.to;
  }
  return {
    start: applyAffine(m, path.start),
    segments,
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
    const include = (point: Vec2): void => {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    };
    include(curve.start);
    let from = curve.start;
    for (const segment of curve.segments) {
      const arc = segment.kind === 'elliptical-arc' ? artworkArcParameters(from, segment) : null;
      if (arc !== null) {
        for (const fraction of artworkArcExtrema(arc)) {
          include(artworkArcPoint(arc, arc.theta1 + arc.delta * fraction));
        }
        include(segment.to);
      } else {
        const b = curveSubpathBounds({ start: from, segments: [segment], closed: false });
        include({ x: b.minX, y: b.minY });
        include({ x: b.maxX, y: b.maxY });
      }
      from = segment.to;
    }
  }
  return [minX, minY, maxX, maxY].every(Number.isFinite) ? { minX, minY, maxX, maxY } : null;
}

/** Flatten transient artwork curves using their retained affine arc parameters. */
export function flattenArtworkCurve(
  path: CurveSubpath,
  options: FlattenCurveOptions,
): FlattenCurveResult {
  const tolerance =
    Number.isFinite(options.toleranceMm) && options.toleranceMm > 0
      ? options.toleranceMm
      : DEFAULT_MACHINE_CURVE_TOLERANCE_MM;
  const budget = Math.max(1, Math.floor(options.segmentBudget ?? MAX_FLATTENED_CURVE_SEGMENTS));
  const points: Vec2[] = [path.start];
  let from = path.start;
  for (const segment of path.segments) {
    const remaining = budget - (points.length - 1);
    const arc = segment.kind === 'elliptical-arc' ? artworkArcParameters(from, segment) : null;
    const additions =
      remaining < 1
        ? null
        : segment.kind === 'cubic'
          ? flattenCubicChords(from, segment, tolerance, remaining)
          : arc === null
            ? [segment.to]
            : flattenArcForArtwork(
                from,
                segment as EllipticalArcPathSegment,
                arc,
                tolerance,
                remaining,
              );
    if (additions === null) return { kind: 'segment-budget-exceeded', segmentBudget: budget };
    for (const point of additions) points.push(point);
    from = segment.to;
  }
  return { kind: 'ok', polyline: { points, closed: path.closed }, segmentCount: points.length - 1 };
}

function flattenArcForArtwork(
  from: Vec2,
  segment: EllipticalArcPathSegment,
  arc: ArtworkParametricArc,
  tolerance: number,
  budget: number,
): Vec2[] | null {
  const error = artworkArcReconstructionError(from, segment);
  const reconstructed = endpointArc(from, segment);
  // Preserve the chord optimizer for ordinary ellipses, reserving the full
  // reconstruction error inside the requested tolerance. Eccentric/singular
  // cases use the source-parametric positive-weight hull bound instead.
  if (reconstructed !== null && error >= 0 && error < tolerance / 2) {
    return flattenEllipseChords(from, segment.to, reconstructed, tolerance - error, budget);
  }
  return flattenArtworkArc(from, segment.to, arc, tolerance, budget);
}

function transformSegment(from: Vec2, segment: PathSegment, m: AffineMatrix): PathSegment[] {
  if (segment.kind === 'line') return [{ kind: 'line', to: applyAffine(m, segment.to) }];
  if (segment.kind === 'cubic') {
    return [
      {
        kind: 'cubic',
        control1: applyAffine(m, segment.control1),
        control2: applyAffine(m, segment.control2),
        to: applyAffine(m, segment.to),
      },
    ];
  }
  return transformArc(from, segment, m);
}

function transformArc(
  from: Vec2,
  segment: EllipticalArcPathSegment,
  m: AffineMatrix,
): PathSegment[] {
  const to = applyAffine(m, segment.to);
  const source = artworkArcParameters(from, segment);
  // SVG omits coincident source endpoints and draws zero-radius arcs as lines.
  if (source === null) return [{ kind: 'line', to }];
  const linear = (point: Vec2): Vec2 => ({
    x: m.a * point.x + m.c * point.y,
    y: m.b * point.x + m.d * point.y,
  });
  const arc: ArtworkParametricArc = {
    ...source,
    center: applyAffine(m, source.center),
    u: linear(source.u),
    v: linear(source.v),
  };
  const gain = Math.max(Math.abs(m.a), Math.abs(m.b), Math.abs(m.c), Math.abs(m.d));
  const determinant = gain === 0 ? 0 : (m.a / gain) * (m.d / gain) - (m.b / gain) * (m.c / gain);
  // A rank-one arc is a sinusoid on a line, not its endpoint chord. Every
  // turnaround must remain in traversal order even when both endpoints match.
  if (determinant === 0) {
    return artworkArcExtrema(arc)
      .slice(1)
      .map((fraction) => ({
        kind: 'line',
        to: fraction === 1 ? to : artworkArcPoint(arc, arc.theta1 + arc.delta * fraction),
      }));
  }
  const { x: p, y: r } = arc.u;
  const { x: q, y: s } = arc.v;
  const svd = singularValues(p, q, r, s);
  // det(A) / sigmaMax avoids subtracting two almost equal singular values.
  // Source radii give det(R(phi)*diag(rx,ry)) without cancellation in A.
  const retained = retainedArtworkArc(segment);
  const rx = retained === null ? Math.hypot(source.u.x, source.u.y) : segment.radiusX;
  const ry = retained === null ? Math.hypot(source.v.x, source.v.y) : segment.radiusY;
  let minor = Math.abs(determinant) * gain * (gain / svd.major) * rx * ry;
  if (minor === 0 || !Number.isFinite(minor)) {
    minor = Math.exp(
      Math.log(Math.abs(determinant)) +
        2 * Math.log(gain) +
        Math.log(rx) +
        Math.log(ry) -
        Math.log(svd.major),
    );
  }
  const mapped: EllipticalArcPathSegment = {
    kind: 'elliptical-arc',
    radiusX: svd.major,
    radiusY: minor,
    rotationDeg: (svd.majorAngle * 180) / Math.PI,
    largeArc: segment.largeArc,
    sweep: determinant < 0 ? !segment.sweep : segment.sweep,
    to,
  };
  return [retainArtworkArc(mapped, arc)];
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
  const scale = Math.max(Math.abs(p), Math.abs(q), Math.abs(r), Math.abs(s));
  if (scale === 0) return { major: 0, minor: 0, majorAngle: 0 };
  const pn = p / scale;
  const qn = q / scale;
  const rn = r / scale;
  const sn = s / scale;
  const e = (pn + sn) / 2;
  const f = (pn - sn) / 2;
  const g = (rn + qn) / 2;
  const h = (rn - qn) / 2;
  const qq = Math.hypot(e, h);
  const rr = Math.hypot(f, g);
  const a1 = Math.atan2(g, f);
  const a2 = Math.atan2(h, e);
  const major = qq + rr;
  return {
    major: major * scale,
    minor: (Math.abs(pn * sn - qn * rn) / major) * scale,
    majorAngle: (a2 + a1) / 2,
  };
}
