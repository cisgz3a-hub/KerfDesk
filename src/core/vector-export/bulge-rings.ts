// Canonical curves → polyline vertices with DXF bulges (ADR-403).
//
// DXF LWPOLYLINE vertices carry a bulge: tan(θ/4) of the included angle of a
// circular arc from that vertex to the next, positive when the arc turns
// counter-clockwise in the DXF (Y-up) frame, 0 for a straight edge.
//
//   * line               → one vertex, bulge 0 (exact)
//   * circular arc       → one vertex with its exact bulge (no fitting)
//   * cubic              → flattened by midpoint subdivision until both
//                          control points lie within `toleranceMm` of the
//                          chord SEGMENT. The cubic lies in its control
//                          hull and segment distance is convex, so the
//                          flattened chord stays within `toleranceMm` of the
//                          curve in both directions (Hausdorff bound).
//   * elliptical arc     → flattened by the shared parametric arc flattener,
//                          whose step keeps rMax·(1 − cos(Δt/2)) ≤ tolerance;
//                          the ellipse is a contraction of its major circle,
//                          so that circle's sagitta bounds the deviation.
//
// Input coordinates are the app's Y-down frame; bulge signs are already
// expressed for the Y-up frame the writer produces by mirroring Y.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import { flattenCurveSubpath } from '../scene/curve-path';
import type {
  CubicPathSegment,
  CurveSubpath,
  EllipticalArcPathSegment,
  Vec2,
} from '../scene/scene-object';

export type BulgeVertex = { readonly x: number; readonly y: number; readonly bulge: number };
export type BulgeRing = { readonly vertices: ReadonlyArray<BulgeVertex>; readonly closed: boolean };

/** Published default: 0.01 mm, a tenth of a typical 0.1 mm laser spot. */
export const DEFAULT_DXF_CURVE_TOLERANCE_MM = 0.01;
const MIN_TOLERANCE_MM = 1e-6;
const MAX_SUBDIVISION_DEPTH = 24;
const CIRCULAR_RELATIVE_EPSILON = 1e-9;

export function curveToBulgeRing(curve: CurveSubpath, toleranceMm: number): BulgeRing {
  const tolerance = Math.max(MIN_TOLERANCE_MM, toleranceMm);
  const vertices: { x: number; y: number; bulge: number }[] = [
    { x: curve.start.x, y: curve.start.y, bulge: 0 },
  ];
  let current = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'line') vertices.push({ ...segment.to, bulge: 0 });
    else if (segment.kind === 'cubic') {
      for (const point of flattenCubic(current, segment, tolerance))
        vertices.push({ ...point, bulge: 0 });
    } else {
      const bulge = circularBulge(current, segment);
      if (bulge !== null) {
        (vertices[vertices.length - 1] as { bulge: number }).bulge = bulge;
        vertices.push({ ...segment.to, bulge: 0 });
      } else {
        for (const point of flattenEllipticalArc(current, segment, tolerance)) {
          vertices.push({ ...point, bulge: 0 });
        }
      }
    }
    current = segment.to;
  }
  return { vertices, closed: curve.closed };
}

/**
 * Exact bulge for an arc that is circular after SVG radius correction, or
 * null for a true ellipse. A zero-length arc is omitted by SVG and has no
 * bulge; a zero radius is a straight line.
 */
export function circularBulge(from: Vec2, segment: EllipticalArcPathSegment): number | null {
  const rx = Math.abs(segment.radiusX);
  const ry = Math.abs(segment.radiusY);
  if (!(rx > 0) || !(ry > 0)) return 0;
  if (Math.abs(rx - ry) > CIRCULAR_RELATIVE_EPSILON * Math.max(rx, ry)) return null;
  const chord = Math.hypot(segment.to.x - from.x, segment.to.y - from.y);
  if (chord === 0) return 0;
  const radius = Math.max(rx, chord / 2);
  const small = 2 * Math.asin(Math.min(1, chord / (2 * radius)));
  const included = segment.largeArc ? 2 * Math.PI - small : small;
  // SVG sweep=1 turns toward +angle in the Y-down frame, which is clockwise
  // once Y is mirrored — a negative DXF bulge.
  return (segment.sweep ? -1 : 1) * Math.tan(included / 4);
}

function flattenCubic(from: Vec2, segment: CubicPathSegment, tolerance: number): Vec2[] {
  const out: Vec2[] = [];
  subdivide(from, segment.control1, segment.control2, segment.to, tolerance, 0, out);
  return out;
}

function subdivide(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  tolerance: number,
  depth: number,
  out: Vec2[],
): void {
  const flat = Math.max(segmentDistance(p1, p0, p3), segmentDistance(p2, p0, p3)) <= tolerance;
  if (flat || depth >= MAX_SUBDIVISION_DEPTH) {
    out.push(p3);
    return;
  }
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const m = mid(p012, p123);
  subdivide(p0, p01, p012, m, tolerance, depth + 1, out);
  subdivide(m, p123, p23, p3, tolerance, depth + 1, out);
}

function flattenEllipticalArc(
  from: Vec2,
  segment: EllipticalArcPathSegment,
  tolerance: number,
): ReadonlyArray<Vec2> {
  const result = flattenCurveSubpath(
    { start: from, segments: [segment], closed: false },
    { toleranceMm: tolerance },
  );
  if (result.kind !== 'ok') throw new Error('An elliptical arc needs too many DXF vertices.');
  return result.polyline.points.slice(1);
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Distance from `p` to the closed segment a–b. */
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
