import type { Polyline, Transform, Vec2 } from '../scene/scene-object';
import { applyTransform } from '../scene/transform';
import { pointInPolygon } from '../geometry/point-in-polygon';
import type { ReliefVectorMask } from '../scene/relief/relief-authoring';

export function inverseReliefPoint(point: Vec2, transform: Transform): Vec2 {
  const angle = (-transform.rotationDeg * Math.PI) / 180;
  const x = point.x - transform.x;
  const y = point.y - transform.y;
  return {
    x:
      ((x * Math.cos(angle) - y * Math.sin(angle)) * (transform.mirrorX ? -1 : 1)) /
      transform.scaleX,
    y:
      ((x * Math.sin(angle) + y * Math.cos(angle)) * (transform.mirrorY ? -1 : 1)) /
      transform.scaleY,
  };
}

export function reliefBoundaryContains(mask: ReliefVectorMask, point: Vec2): boolean {
  let inside = false;
  for (const ring of mask.rings) {
    // Boundary is included; mask never expands beyond its actual geometry.
    if (
      ring.points.some((a, index) =>
        onSegment(point, a, ring.points[(index + 1) % ring.points.length] ?? a),
      )
    )
      return true;
    if (pointInPolygon(point, ring.points)) inside = !inside;
  }
  return inside;
}

export function reliefBoundaryBounds(mask: ReliefVectorMask): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const ring of mask.rings)
    for (const p of ring.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return { minX, minY, maxX, maxY };
}

export function reliefBoundarySizeError(rings: ReadonlyArray<Polyline>): string | null {
  if (rings.length > 128) return 'Relief boundaries support up to 128 rings.';
  let vertices = 0;
  for (const ring of rings) {
    const first = ring.points[0],
      last = ring.points[ring.points.length - 1];
    const repeatedEnd =
      first !== undefined && last !== undefined && first.x === last.x && first.y === last.y;
    vertices += ring.points.length - (repeatedEnd ? 1 : 0);
    if (vertices > 1024)
      return 'Relief boundaries support up to 1024 vertices; simplify explicitly before creation.';
  }
  return null;
}

/** Reject crossing/touching rings: no inferred repairs or multi-valued surfaces. */
type BoundarySegment = { a: Vec2; b: Vec2; ring: number; edge: number; count: number };
export function reliefBoundaryError(mask: ReliefVectorMask, allowEmpty = true): string | null {
  if (mask.rings.length === 0) return allowEmpty ? null : 'Choose at least one closed boundary.';
  const sizeError = reliefBoundarySizeError(mask.rings);
  if (sizeError !== null) return sizeError;
  const segments: BoundarySegment[] = [];
  let vertices = 0;
  for (const [ri, ring] of mask.rings.entries()) {
    const points = stripClosingPoint(ring.points);
    vertices += points.length;
    if (vertices > 1024)
      return 'Relief boundaries support up to 1024 vertices; simplify explicitly before creation.';
    const error = appendRingSegments(points, ring.closed, ri, segments);
    if (error !== null) return error;
  }
  return crossingBoundaryError(segments);
}
function appendRingSegments(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  ri: number,
  segments: BoundarySegment[],
): string | null {
  if (!closed || points.length < 3)
    return 'Relief boundaries must be closed with at least three points.';
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) return 'Relief boundary has missing points.';
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite) || (a.x === b.x && a.y === b.y))
      return 'Relief boundary has invalid or repeated points.';
    area += a.x * b.y - b.x * a.y;
    segments.push({ a, b, ring: ri, edge: i, count: points.length });
  }
  return Math.abs(area) < 1e-10 ? 'Relief boundary encloses no usable area.' : null;
}
function crossingBoundaryError(segments: ReadonlyArray<BoundarySegment>): string | null {
  for (const [i, a] of segments.entries())
    for (let j = i + 1; j < segments.length; j += 1) {
      const b = segments[j];
      if (b === undefined) continue;
      const adjacent = a.ring === b.ring && [1, a.count - 1].includes(Math.abs(a.edge - b.edge));
      if (adjacent) continue;
      if (segmentsMeet(a.a, a.b, b.a, b.b))
        return 'Self-intersecting, overlapping or touching relief boundaries are unsupported.';
    }
  return null;
}
export function reliefMaskInLocalSpace(
  rings: ReadonlyArray<Polyline>,
  sourceTransform: Transform,
  targetTransform: Transform,
): ReliefVectorMask {
  return {
    rings: rings.map((ring) => ({
      closed: ring.closed,
      points: stripClosingPoint(ring.points).map((p) =>
        inverseReliefPoint(applyTransform(p, sourceTransform), targetTransform),
      ),
    })),
  };
}

function stripClosingPoint(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const a = points[0],
    b = points[points.length - 1];
  return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y
    ? points.slice(0, -1)
    : points;
}
function cross(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}
function onSegment(p: Vec2, a: Vec2, b: Vec2): boolean {
  return (
    Math.abs(cross(a, b, p)) <= 1e-10 &&
    p.x >= Math.min(a.x, b.x) - 1e-10 &&
    p.x <= Math.max(a.x, b.x) + 1e-10 &&
    p.y >= Math.min(a.y, b.y) - 1e-10 &&
    p.y <= Math.max(a.y, b.y) + 1e-10
  );
}
function segmentsMeet(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return (
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d) ||
    (cross(a, b, c) > 0 !== cross(a, b, d) > 0 && cross(c, d, a) > 0 !== cross(c, d, b) > 0)
  );
}
