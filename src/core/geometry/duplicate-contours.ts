// duplicate-contours — decide whether two world-space contours cut the same
// line (ADR-377, Delete Duplicates). LightBurn removes only exact copies. Here
// a copy still matches when its points sit within the tolerance, when a closed
// copy starts at another vertex or runs the other way, and when an open copy
// runs backwards, because each of those burns the same line twice.

import type { Vec2 } from '../scene';

export const DUPLICATE_TOLERANCE_MM = 0.01;

// Points closer than this are one point: the repeated closing vertex of a
// closed contour and zero-length segments say nothing about the line cut.
const SAME_POINT_MM = 1e-6;
// The resampling fallback compares every sample of one contour with every
// segment of the other. Above this much work the pair is left alone: keeping
// a real duplicate is safe, deleting a distinct contour is not.
const MAX_RESAMPLE_WORK = 4_000_000;
// Candidate lookup buckets contours by the corner of their bounds. A copy's
// corner is within the tolerance, so the neighbouring cells always hold it
// while a cell is at least twice the tolerance.
const CELL_MM = 1;

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type ComparableContour = {
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
  readonly box: Box;
  readonly length: number;
};

export type ContourIndex = {
  /** True when a contour already in the index with the same key matches. */
  readonly hasMatch: (key: string, contour: ComparableContour) => boolean;
  readonly add: (key: string, contour: ComparableContour) => void;
};

/** Clean a world-space polyline for comparison, or null when it has no length. */
export function comparableContour(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  toleranceMm = DUPLICATE_TOLERANCE_MM,
): ComparableContour | null {
  const cleaned = withoutRepeatedPoints(points);
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (first === undefined || last === undefined) return null;
  const endsMeet = distance(first, last) <= toleranceMm;
  // An open contour that returns to its start cuts the same loop as a closed one.
  const isClosed = closed || (endsMeet && cleaned.length > 3);
  if (isClosed && endsMeet && cleaned.length > 1) cleaned.pop();
  if (cleaned.length < 2) return null;
  return {
    points: cleaned,
    closed: isClosed,
    box: boxOf(cleaned),
    length: pathLength(cleaned, isClosed),
  };
}

function withoutRepeatedPoints(points: ReadonlyArray<Vec2>): Vec2[] {
  const cleaned: Vec2[] = [];
  for (const point of points) {
    const previous = cleaned[cleaned.length - 1];
    if (previous === undefined || distance(previous, point) > SAME_POINT_MM) cleaned.push(point);
  }
  return cleaned;
}

export function createContourIndex(toleranceMm = DUPLICATE_TOLERANCE_MM): ContourIndex {
  const cellMm = Math.max(CELL_MM, 2 * toleranceMm);
  const cellOf = (contour: ComparableContour): readonly [number, number] => [
    Math.floor(contour.box.minX / cellMm),
    Math.floor(contour.box.minY / cellMm),
  ];
  const cells = new Map<
    string,
    Array<{ readonly key: string; readonly contour: ComparableContour }>
  >();
  return {
    hasMatch: (key, contour) => {
      const [column, row] = cellOf(contour);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const entries = cells.get(`${column + dx}:${row + dy}`) ?? [];
          for (const entry of entries) {
            if (entry.key === key && contoursMatch(entry.contour, contour, toleranceMm))
              return true;
          }
        }
      }
      return false;
    },
    add: (key, contour) => {
      const [column, row] = cellOf(contour);
      const cell = `${column}:${row}`;
      const entries = cells.get(cell);
      if (entries === undefined) cells.set(cell, [{ key, contour }]);
      else entries.push({ key, contour });
    },
  };
}

/** Whether two contours cut the same line within `toleranceMm`. */
export function contoursMatch(
  a: ComparableContour,
  b: ComparableContour,
  toleranceMm = DUPLICATE_TOLERANCE_MM,
): boolean {
  if (a.closed !== b.closed || !boxesMatch(a.box, b.box, toleranceMm)) return false;
  // Each vertex may sit up to the tolerance away, so each segment's length may
  // differ by twice that. A path that doubles back over itself fails here.
  const segments = Math.max(a.points.length, b.points.length);
  if (Math.abs(a.length - b.length) > 2 * toleranceMm * segments + SAME_POINT_MM) return false;
  if (a.points.length === b.points.length && sameVertexCycle(a, b, toleranceMm)) return true;
  return resampledMatch(a, b, toleranceMm) && resampledMatch(b, a, toleranceMm);
}

function sameVertexCycle(a: ComparableContour, b: ComparableContour, toleranceMm: number): boolean {
  const count = a.points.length;
  const start = a.points[0];
  if (start === undefined) return false;
  const offsets = a.closed ? [...Array(count).keys()] : [0, count - 1];
  for (const offset of offsets) {
    const candidate = b.points[offset];
    if (candidate === undefined || distance(start, candidate) > toleranceMm) continue;
    if (a.closed || offset === 0) {
      if (walks(a, b, offset, 1, toleranceMm)) return true;
    }
    if (a.closed || offset === count - 1) {
      if (walks(a, b, offset, -1, toleranceMm)) return true;
    }
  }
  return false;
}

function walks(
  a: ComparableContour,
  b: ComparableContour,
  offset: number,
  step: 1 | -1,
  toleranceMm: number,
): boolean {
  const count = a.points.length;
  for (let index = 0; index < count; index += 1) {
    const other = b.points[(((offset + step * index) % count) + count) % count];
    const point = a.points[index];
    if (point === undefined || other === undefined || distance(point, other) > toleranceMm) {
      return false;
    }
  }
  return true;
}

// Every vertex and segment midpoint of `a` lies within the tolerance of `b`.
function resampledMatch(a: ComparableContour, b: ComparableContour, toleranceMm: number): boolean {
  const samples = segmentsOf(a).flatMap(([from, to]) => [from, midpoint(from, to)]);
  if (!a.closed) {
    const last = a.points[a.points.length - 1];
    if (last !== undefined) samples.push(last);
  }
  const targets = segmentsOf(b);
  if (samples.length * targets.length > MAX_RESAMPLE_WORK) return false;
  return samples.every((sample) =>
    targets.some(([from, to]) => distanceToSegment(sample, from, to) <= toleranceMm),
  );
}

function segmentsOf(contour: ComparableContour): Array<readonly [Vec2, Vec2]> {
  const points = contour.points;
  const segments: Array<readonly [Vec2, Vec2]> = [];
  const count = contour.closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const from = points[index];
    const to = points[(index + 1) % points.length];
    if (from !== undefined && to !== undefined) segments.push([from, to]);
  }
  return segments;
}

function boxesMatch(a: Box, b: Box, toleranceMm: number): boolean {
  return (
    Math.abs(a.minX - b.minX) <= toleranceMm &&
    Math.abs(a.minY - b.minY) <= toleranceMm &&
    Math.abs(a.maxX - b.maxX) <= toleranceMm &&
    Math.abs(a.maxY - b.maxY) <= toleranceMm
  );
}

function boxOf(points: ReadonlyArray<Vec2>): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function pathLength(points: ReadonlyArray<Vec2>, closed: boolean): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from !== undefined && to !== undefined) length += distance(from, to);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (closed && first !== undefined && last !== undefined) length += distance(last, first);
  return length;
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, from);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  );
  return distance(point, { x: from.x + t * dx, y: from.y + t * dy });
}
