import { pointInPolygon } from '../geometry';
import type { Polyline, Vec2 } from '../scene';
import { ContourBoxIndex } from '../trace/contour-box-index';
import {
  buildVCarveBoundarySegmentIndex,
  someVCarveBoundarySegmentInBox,
  type VCarveBoundarySegmentIndex,
  type VCarveBoundaryBox,
} from './vcarve-boundary-segment-index';
import type { BoundarySegment } from './vcarve-detail-geometry';

type PreparedContour = VCarveBoundaryBox & {
  readonly contour: Polyline;
  readonly sourceIndex: number;
  readonly closedFinite: boolean;
  readonly distinctPointCount: number;
  readonly coordinateScale: number;
  boundaryIndex: VCarveBoundarySegmentIndex | undefined;
};

export type PreparedStrictContourNesting = {
  readonly source: ReadonlyArray<Polyline>;
  readonly contours: ReadonlyArray<PreparedContour>;
  readonly candidates: ContourBoxIndex<PreparedContour>;
};

/** One snapshot-local broad phase; exact touching and crossing tests remain authoritative. */
export function prepareStrictContourNesting(
  source: ReadonlyArray<Polyline>,
): PreparedStrictContourNesting {
  const contours = source.map(prepareContour);
  return {
    source,
    contours,
    candidates: ContourBoxIndex.create(contours.filter((contour) => contour.closedFinite)),
  };
}

export function isClosedFiniteContour(contour: Polyline): boolean {
  return (
    contour.closed &&
    distinctClosedPointCount(contour) >= 3 &&
    contour.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  );
}

/** True only when the whole inner boundary is separated from and inside the outer boundary. */
export function strictlyContainsContour(outer: Polyline, inner: Polyline): boolean {
  return strictlyContainsPreparedContour(prepareContour(outer, 0), prepareContour(inner, 1));
}

export function strictContourContainmentDepth(
  contour: Polyline,
  contourIndex: number,
  contours: ReadonlyArray<Polyline>,
  prepared?: PreparedStrictContourNesting,
): number {
  const index = prepared?.source === contours ? prepared : prepareStrictContourNesting(contours);
  const entry = index.contours[contourIndex];
  const inner = entry?.contour === contour ? entry : prepareContour(contour, contourIndex);
  return index.candidates
    .query(inner)
    .reduce(
      (depth, candidate) =>
        candidate.sourceIndex !== contourIndex && strictlyContainsPreparedContour(candidate, inner)
          ? depth + 1
          : depth,
      0,
    );
}

function strictlyContainsPreparedContour(outer: PreparedContour, inner: PreparedContour): boolean {
  const probe = inner.contour.points[0];
  if (probe === undefined || !boundsContain(outer, inner) || boundariesIntersect(outer, inner)) {
    return false;
  }
  return pointInPolygon(probe, outer.contour.points);
}

function boundsContain(outer: VCarveBoundaryBox, inner: VCarveBoundaryBox): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

function prepareContour(contour: Polyline, sourceIndex: number): PreparedContour {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let coordinateScale = 1;
  let finite = true;
  for (const { x, y } of contour.points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    coordinateScale = Math.max(coordinateScale, Math.abs(x), Math.abs(y));
    finite = finite && Number.isFinite(x) && Number.isFinite(y);
  }
  const distinctPointCount = distinctClosedPointCount(contour);
  return {
    contour,
    sourceIndex,
    minX,
    minY,
    maxX,
    maxY,
    coordinateScale,
    distinctPointCount,
    closedFinite: contour.closed && distinctPointCount >= 3 && finite,
    boundaryIndex: undefined,
  };
}

function boundariesIntersect(a: PreparedContour, b: PreparedContour): boolean {
  // Reuse the exact-query boundary index: only disjoint segment boxes are
  // excluded, so touching and crossing still use the original predicate.
  // Every candidate owns one lazy index across the snapshot's nesting queries.
  const index = (a.boundaryIndex ??= buildVCarveBoundarySegmentIndex(contourSegments(a)));
  const precision = Number.EPSILON * 32 * Math.max(a.coordinateScale, b.coordinateScale);
  const bCount = b.distinctPointCount;
  for (let bi = 0; bi < bCount; bi += 1) {
    const b0 = b.contour.points[bi];
    const b1 = b.contour.points[(bi + 1) % bCount];
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

function contourSegments(prepared: PreparedContour): BoundarySegment[] {
  const count = prepared.distinctPointCount;
  const segments: BoundarySegment[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = prepared.contour.points[i];
    const end = prepared.contour.points[(i + 1) % count];
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
