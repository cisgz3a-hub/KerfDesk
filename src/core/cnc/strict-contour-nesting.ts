import { pointInPolygon } from '../geometry';
import type { Polyline, Vec2 } from '../scene';

export function isClosedFiniteContour(contour: Polyline): boolean {
  return (
    contour.closed &&
    distinctClosedPointCount(contour) >= 3 &&
    contour.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  );
}

/** True only when the whole inner boundary is separated from and inside the outer boundary. */
export function strictlyContainsContour(outer: Polyline, inner: Polyline): boolean {
  const probe = inner.points[0];
  if (probe === undefined || !boundsContain(outer, inner) || boundariesIntersect(outer, inner)) {
    return false;
  }
  return pointInPolygon(probe, outer.points);
}

export function strictContourContainmentDepth(
  contour: Polyline,
  contourIndex: number,
  contours: ReadonlyArray<Polyline>,
): number {
  return contours.reduce(
    (depth, candidate, candidateIndex) =>
      candidateIndex !== contourIndex &&
      isClosedFiniteContour(candidate) &&
      strictlyContainsContour(candidate, contour)
        ? depth + 1
        : depth,
    0,
  );
}

function boundsContain(outer: Polyline, inner: Polyline): boolean {
  const a = polylineBounds(outer);
  const b = polylineBounds(inner);
  return a.minX <= b.minX && a.minY <= b.minY && a.maxX >= b.maxX && a.maxY >= b.maxY;
}

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function polylineBounds(polyline: Polyline): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polyline.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function boundariesIntersect(a: Polyline, b: Polyline): boolean {
  const aCount = distinctClosedPointCount(a);
  const bCount = distinctClosedPointCount(b);
  for (let ai = 0; ai < aCount; ai += 1) {
    const a0 = a.points[ai];
    const a1 = a.points[(ai + 1) % aCount];
    if (a0 === undefined || a1 === undefined) continue;
    for (let bi = 0; bi < bCount; bi += 1) {
      const b0 = b.points[bi];
      const b1 = b.points[(bi + 1) % bCount];
      if (b0 !== undefined && b1 !== undefined && segmentsIntersect(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

function distinctClosedPointCount(polyline: Polyline): number {
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  return first !== undefined && last !== undefined && first.x === last.x && first.y === last.y
    ? polyline.points.length - 1
    : polyline.points.length;
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
