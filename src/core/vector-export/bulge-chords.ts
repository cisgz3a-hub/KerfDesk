// Straight chords for curved DXF edges (ADR-431, kept by ADR-452).
//
// ADR-431's chord writer, used where the arc fit cannot do better:
//   * cubic          → midpoint subdivision until both control points lie
//                      within `toleranceMm` of the chord SEGMENT. The cubic
//                      lies in its control hull and segment distance is
//                      convex, so each chord stays within `toleranceMm` of
//                      the curve in both directions (Hausdorff bound).
//   * elliptical arc → the shared parametric arc flattener, whose step keeps
//                      rMax·(1 − cos(Δt/2)) ≤ tolerance; the ellipse is a
//                      contraction of its major circle, so that circle's
//                      sagitta bounds the deviation.
// Every edge is straight (bulge 0) and the last one ends exactly where the
// run's last segment ends.
//
// Pure-core compliant: no clock, no random, no I/O, no DOM.

import { flattenArtworkCurve } from './affine-curves';
import type {
  CubicPathSegment,
  EllipticalArcPathSegment,
  PathSegment,
  Vec2,
} from '../scene/scene-object';
import type { BulgeEdge } from './bulge-arc-fit';

const MAX_SUBDIVISION_DEPTH = 24;

/** Chord edges for a run of cubics and elliptical arcs starting at `from`. */
export function chordCurveEdges(
  from: Vec2,
  segments: ReadonlyArray<PathSegment>,
  toleranceMm: number,
): BulgeEdge[] {
  const edges: BulgeEdge[] = [];
  let current = from;
  for (const segment of segments) {
    const points =
      segment.kind === 'cubic'
        ? flattenCubic(current, segment, toleranceMm)
        : segment.kind === 'elliptical-arc'
          ? flattenEllipticalArc(current, segment, toleranceMm)
          : [segment.to];
    for (const to of points) edges.push({ to, bulge: 0 });
    current = segment.to;
  }
  return edges;
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
  const result = flattenArtworkCurve(
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
