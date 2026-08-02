// detailPath3dPoints — per-vertex depths for thin-detail rings (ADR-282
// junction blend).
//
// A detail ring's pitch-based depth measures its inset from the SLIVER
// boundary. Along a stroke's sides that boundary is the artwork edge, so the
// depth is right; across the artificial junction cut-line — where a sliver
// meets ladder-covered material — the true source boundary is farther away,
// and constant-depth rings under-cut for about one δ of travel: the dark
// seams at stroke-width transitions in script lettering. The planned profile
// follows z = −min(distToSourceBoundary / tan(θ/2), maxDepth), then shifts
// conservatively shallow enough to stay non-gouging after 0.001 mm XYZ
// formatting.
//
// Clipper rings keep vertices only at corners, and a straight ring edge that
// crosses the junction would lerp its shallow corner depths straight across
// the deep middle. Certified depth-range leaves are stitched from adjacent
// minima, so every chord stays on the under-cut side of the analytic law.
// Multiple hidden depth knees cannot pass merely because one midpoint agrees.
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
const EMIT_COORDINATE_QUANTUM_MM = 0.001;
const XY_ROUNDING_RADIUS_MM = (Math.SQRT2 * EMIT_COORDINATE_QUANTUM_MM) / 2;
const Z_ROUNDING_HALF_QUANTUM_MM = EMIT_COORDINATE_QUANTUM_MM / 2;

export type DetailPath3dPlan = {
  readonly points: ReadonlyArray<Vec3>;
  readonly toleranceMet: boolean;
};

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
 * The ring's polyline as a closed conservative path3d profile. The emitted
 * XYZ chord never cuts deeper than the analytic groove; when the 0.001 mm
 * output grid can represent it, under-cut stays within Z_TOLERANCE_MM.
 */
export function detailPath3dPoints(
  polyline: Polyline,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): ReadonlyArray<Vec3> {
  return detailPath3dPlan(polyline, segments, law).points;
}

export function detailPath3dPlan(
  polyline: Polyline,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): DetailPath3dPlan {
  const ring = closedPoints(polyline.points);
  const marginMm = emissionSafetyMarginMm(law);
  const certifiedRangeMm = Z_TOLERANCE_MM / 2 - marginMm;
  let toleranceMet = Number.isFinite(certifiedRangeMm) && certifiedRangeMm > 0;
  const targetRangeMm = toleranceMet ? certifiedRangeMm : Z_TOLERANCE_MM / 2;
  const minimumSpanMm = toleranceMet ? 0 : EMIT_COORDINATE_QUANTUM_MM;
  const leaves: DepthLeaf[] = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a === undefined || b === undefined) continue;
    const partition = partitionDepthLeaves(a, b, segments, law, targetRangeMm, minimumSpanMm);
    leaves.push(...partition.leaves);
    toleranceMet = toleranceMet && partition.certified;
  }
  if (leaves.length === 0) return { points: [], toleranceMet };

  const rawPoints = leaves.map((leaf, index) => {
    const previous = leaves[(index - 1 + leaves.length) % leaves.length];
    const adjacentMinimum = Math.min(previous?.minDepthMm ?? 0, leaf.minDepthMm);
    const safeDepth = Math.max(0, adjacentMinimum - marginMm);
    return { x: leaf.a.x, y: leaf.a.y, z: -safeDepth };
  });
  const collapsed = collapseAtEmitPrecision(rawPoints);
  toleranceMet = toleranceMet && !collapsed.collapsed;
  const points = [...collapsed.points];
  const first = points[0];
  if (first !== undefined) {
    points.push({ ...first });
  }
  return { points, toleranceMet };
}

function closedPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points : [...points, first];
}

type DepthLeaf = {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly minDepthMm: number;
  readonly maxDepthMm: number;
};

function partitionDepthLeaves(
  a: Vec2,
  b: Vec2,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
  targetRangeMm: number,
  minimumSpanMm: number,
): { readonly leaves: ReadonlyArray<DepthLeaf>; readonly certified: boolean } {
  const leaves: DepthLeaf[] = [];
  const pending: Array<{ readonly a: Vec2; readonly b: Vec2 }> = [{ a, b }];
  let certified = true;
  while (pending.length > 0) {
    const span = pending.pop();
    if (span === undefined) continue;
    const bounds = depthBoundsOnSpan(span.a, span.b, segments, law);
    const rangeMm = bounds.maxDepthMm - bounds.minDepthMm;
    const spanLengthMm = Math.hypot(span.b.x - span.a.x, span.b.y - span.a.y);
    if (rangeMm <= targetRangeMm || (minimumSpanMm > 0 && spanLengthMm <= minimumSpanMm)) {
      leaves.push({ ...span, ...bounds });
      certified = certified && rangeMm <= targetRangeMm;
      continue;
    }
    const mid = { x: (span.a.x + span.b.x) / 2, y: (span.a.y + span.b.y) / 2 };
    if ((mid.x === span.a.x && mid.y === span.a.y) || (mid.x === span.b.x && mid.y === span.b.y)) {
      leaves.push({ ...span, ...bounds });
      certified = false;
      continue;
    }
    pending.push({ a: mid, b: span.b });
    pending.push({ a: span.a, b: mid });
  }
  return { leaves, certified };
}

function emissionSafetyMarginMm(law: DetailDepthLaw): number {
  if (!(law.tanHalf > 0) || !Number.isFinite(law.tanHalf)) {
    return Number.POSITIVE_INFINITY;
  }
  return XY_ROUNDING_RADIUS_MM / law.tanHalf + Z_ROUNDING_HALF_QUANTUM_MM;
}

function collapseAtEmitPrecision(points: ReadonlyArray<Vec3>): {
  readonly points: ReadonlyArray<Vec3>;
  readonly collapsed: boolean;
} {
  const out: Vec3[] = [];
  let collapsed = false;
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous !== undefined && emitXyKey(previous) === emitXyKey(point)) {
      out[out.length - 1] = { ...previous, z: Math.max(previous.z, point.z) };
      collapsed = true;
      continue;
    }
    out.push(point);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (
    first !== undefined &&
    last !== undefined &&
    out.length > 1 &&
    emitXyKey(first) === emitXyKey(last)
  ) {
    out[0] = { ...first, z: Math.max(first.z, last.z) };
    out.pop();
    collapsed = true;
  }
  return { points: out, collapsed };
}

function emitXyKey(point: Vec3): string {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
}

function depthBoundsOnSpan(
  a: Vec2,
  b: Vec2,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): { readonly minDepthMm: number; readonly maxDepthMm: number } {
  let lowerDistance = Number.POSITIVE_INFINITY;
  let upperDistance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    lowerDistance = Math.min(lowerDistance, segmentToSegmentDistance(a, b, segment));
    upperDistance = Math.min(
      upperDistance,
      Math.max(
        pointToSegmentDistance(a.x, a.y, segment),
        pointToSegmentDistance(b.x, b.y, segment),
      ),
    );
  }
  return {
    minDepthMm: depthForDistance(lowerDistance, law),
    maxDepthMm: depthForDistance(upperDistance, law),
  };
}

function depthForDistance(distanceMm: number, law: DetailDepthLaw): number {
  return Math.min(distanceMm / law.tanHalf, law.maxDepthMm);
}

function segmentToSegmentDistance(a: Vec2, b: Vec2, segment: BoundarySegment): number {
  const c = { x: segment.ax, y: segment.ay };
  const d = { x: segment.bx, y: segment.by };
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a.x, a.y, segment),
    pointToSegmentDistance(b.x, b.y, segment),
    pointToSegmentDistance(c.x, c.y, { ax: a.x, ay: a.y, bx: b.x, by: b.y }),
    pointToSegmentDistance(d.x, d.y, { ax: a.x, ay: a.y, bx: b.x, by: b.y }),
  );
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (abC === 0 && onSegment(a, b, c)) return true;
  if (abD === 0 && onSegment(a, b, d)) return true;
  if (cdA === 0 && onSegment(c, d, a)) return true;
  if (cdB === 0 && onSegment(c, d, b)) return true;
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0;
}

function cross(a: Vec2, b: Vec2, point: Vec2): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function onSegment(a: Vec2, b: Vec2, point: Vec2): boolean {
  return (
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y)
  );
}

function pointToSegmentDistance(x: number, y: number, segment: BoundarySegment): number {
  const abx = segment.bx - segment.ax;
  const aby = segment.by - segment.ay;
  const lengthSq = abx * abx + aby * aby;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - segment.ax) * abx + (y - segment.ay) * aby) / lengthSq));
  const dx = x - (segment.ax + t * abx);
  const dy = y - (segment.ay + t * aby);
  return Math.hypot(dx, dy);
}
