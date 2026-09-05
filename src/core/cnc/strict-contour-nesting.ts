import { pointInPolygon } from '../geometry';
import type { Polyline, Vec2 } from '../scene';
import {
  buildVCarveBoundarySegmentIndex,
  someVCarveBoundarySegmentInBox,
} from './vcarve-boundary-segment-index';
import type { BoundarySegment } from './vcarve-detail-geometry';

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
  // Reuse the exact-query boundary index: only disjoint segment boxes are
  // excluded, so touching and crossing still use the original predicate.
  // A dense trace must not compare every edge to every other edge.
  const index = buildVCarveBoundarySegmentIndex(contourSegments(a));
  const precision = Number.EPSILON * 32 * Math.max(coordinateScale(a), coordinateScale(b));
  const bCount = distinctClosedPointCount(b);
  for (let bi = 0; bi < bCount; bi += 1) {
    const b0 = b.points[bi];
    const b1 = b.points[(bi + 1) % bCount];
    if (b0 === undefined || b1 === undefined) continue;
    const box = {
      minX: Math.min(b0.x, b1.x) - precision,
      minY: Math.min(b0.y, b1.y) - precision,
      maxX: Math.max(b0.x, b1.x) + precision,
      maxY: Math.max(b0.y, b1.y) + precision,
    };
    if (
      someVCarveBoundarySegmentInBox(index, box, (segment) =>
        segmentsIntersect(
          { x: segment.ax, y: segment.ay },
          { x: segment.bx, y: segment.by },
          b0,
          b1,
          precision,
        ),
      )
    )
      return true;
  }
  return false;
}

function coordinateScale(polyline: Polyline): number {
  let scale = 1;
  for (const point of polyline.points)
    scale = Math.max(scale, Math.abs(point.x), Math.abs(point.y));
  return scale;
}

function contourSegments(polyline: Polyline): BoundarySegment[] {
  const count = distinctClosedPointCount(polyline);
  const segments: BoundarySegment[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = polyline.points[i];
    const end = polyline.points[(i + 1) % count];
    if (start !== undefined && end !== undefined) {
      segments.push({ ax: start.x, ay: start.y, bx: end.x, by: end.y });
    }
  }
  return segments;
}

function distinctClosedPointCount(polyline: Polyline): number {
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  return first !== undefined && last !== undefined && first.x === last.x && first.y === last.y
    ? polyline.points.length - 1
    : polyline.points.length;
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2, precision: number): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  // Transforms can move a touching vertex a few ULPs off its edge. Preserve
  // contact at coordinate precision, using the same padding as the index.
  const abPrecision = (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * precision;
  const cdPrecision = (Math.abs(d.x - c.x) + Math.abs(d.y - c.y)) * precision;
  if (Math.abs(abC) <= abPrecision && onSegment(a, b, c, precision)) return true;
  if (Math.abs(abD) <= abPrecision && onSegment(a, b, d, precision)) return true;
  if (Math.abs(cdA) <= cdPrecision && onSegment(c, d, a, precision)) return true;
  if (Math.abs(cdB) <= cdPrecision && onSegment(c, d, b, precision)) return true;
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0;
}

function cross(a: Vec2, b: Vec2, point: Vec2): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function onSegment(a: Vec2, b: Vec2, point: Vec2, precision: number): boolean {
  return (
    point.x >= Math.min(a.x, b.x) - precision &&
    point.x <= Math.max(a.x, b.x) + precision &&
    point.y >= Math.min(a.y, b.y) - precision &&
    point.y <= Math.max(a.y, b.y) + precision
  );
}
