// detailPath3dPoints — per-vertex depths for thin-detail rings (ADR-279
// junction blend).
//
// A detail ring's pitch-based depth measures its inset from the SLIVER
// boundary. Along a stroke's sides that boundary is the artwork edge, so the
// depth is right; across the artificial junction cut-line — where a sliver
// meets ladder-covered material — the true source boundary is farther away,
// and constant-depth rings under-cut for about one δ of travel: the dark
// seams at stroke-width transitions in script lettering. Each ring vertex
// now carries z = −min(distToSourceBoundary / tan(θ/2), maxDepth), the same
// law the analytic groove obeys.
//
// Clipper rings keep vertices only at corners, and a straight ring edge that
// crosses the junction would lerp its shallow corner depths straight across
// the deep middle. Segments therefore subdivide adaptively until the linear
// G1 interpolation matches the depth law within Z_TOLERANCE_MM — vertices
// concentrate at the junction depth knee while a boundary-parallel side
// stays two vertices.
//
// Pure and deterministic; distance is an exact point-to-segment minimum over
// the source contours (flattened once per layer by the caller).

import type { Vec3 } from '../geometry/vec3';
import type { Polyline, Vec2 } from '../scene';

export type DetailDepthLaw = {
  readonly tanHalf: number;
  readonly maxDepthMm: number;
};

export type BoundarySegment = {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
};

// Where the linear Z lerp may diverge from the true groove before another
// vertex is inserted — comfortably under the 0.05 mm fine ring pitch.
const Z_TOLERANCE_MM = 0.02;
// Stop subdividing below the fine pitch: features that small are already at
// the stage's resolution floor.
const MIN_SPAN_MM = 0.05;
const MAX_REFINE_DEPTH = 8;

export function sourceBoundarySegments(
  contours: ReadonlyArray<Polyline>,
): ReadonlyArray<BoundarySegment> {
  const segments: BoundarySegment[] = [];
  for (const contour of contours) {
    const points = contour.points;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }
  return segments;
}

/**
 * The ring's polyline as closed path3d points: per-vertex true-boundary
 * depth, adaptively subdivided so the emitter's linear XYZ interpolation
 * tracks the groove law within Z_TOLERANCE_MM.
 */
export function detailPath3dPoints(
  polyline: Polyline,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): ReadonlyArray<Vec3> {
  const ring = closedPoints(polyline.points);
  const out: Vec3[] = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a === undefined || b === undefined) continue;
    const za = -depthAt(a.x, a.y, segments, law);
    const zb = -depthAt(b.x, b.y, segments, law);
    out.push({ x: a.x, y: a.y, z: za });
    appendRefined(out, { a, za, b, zb }, segments, law, 0);
  }
  const seam = ring[ring.length - 1];
  if (seam !== undefined) {
    out.push({ x: seam.x, y: seam.y, z: -depthAt(seam.x, seam.y, segments, law) });
  }
  return out;
}

function closedPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}

type RefineSpan = {
  readonly a: Vec2;
  readonly za: number;
  readonly b: Vec2;
  readonly zb: number;
};

// In-order midpoint refinement: left half's interior vertices, the midpoint,
// then the right half's — so `out` stays a walkable ring.
function appendRefined(
  out: Vec3[],
  span: RefineSpan,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
  depth: number,
): void {
  if (depth >= MAX_REFINE_DEPTH) return;
  if (Math.hypot(span.b.x - span.a.x, span.b.y - span.a.y) <= MIN_SPAN_MM) return;
  const mid = { x: (span.a.x + span.b.x) / 2, y: (span.a.y + span.b.y) / 2 };
  const zm = -depthAt(mid.x, mid.y, segments, law);
  if (Math.abs(zm - (span.za + span.zb) / 2) <= Z_TOLERANCE_MM) return;
  appendRefined(out, { a: span.a, za: span.za, b: mid, zb: zm }, segments, law, depth + 1);
  out.push({ x: mid.x, y: mid.y, z: zm });
  appendRefined(out, { a: mid, za: zm, b: span.b, zb: span.zb }, segments, law, depth + 1);
}

function depthAt(
  x: number,
  y: number,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): number {
  return Math.min(distToBoundary(x, y, segments) / law.tanHalf, law.maxDepthMm);
}

function distToBoundary(x: number, y: number, segments: ReadonlyArray<BoundarySegment>): number {
  let min = Number.POSITIVE_INFINITY;
  for (const s of segments) {
    const abx = s.bx - s.ax;
    const aby = s.by - s.ay;
    const lengthSq = abx * abx + aby * aby;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - s.ax) * abx + (y - s.ay) * aby) / lengthSq));
    const dx = x - (s.ax + t * abx);
    const dy = y - (s.ay + t * aby);
    const d = dx * dx + dy * dy;
    if (d < min) min = d;
  }
  return Math.sqrt(min);
}
