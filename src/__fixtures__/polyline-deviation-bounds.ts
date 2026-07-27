import type { Vec2 } from '../core/scene';

const DEGENERATE_SEGMENT_EPSILON_SQUARED = 1e-18;
const LIPSCHITZ_SAMPLE_SPACING_FACTOR = 2;
const MAXIMUM_SAMPLE_DISTANCE_FACTOR = 0.5;
const MIN_POLYLINE_POINT_COUNT = 2;
const SEGMENT_LEAF_SIZE = 8;

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type IndexedSegment = Bounds & {
  readonly start: Vec2;
  readonly end: Vec2;
};

type SegmentIndex =
  | (Bounds & { readonly segments: ReadonlyArray<IndexedSegment> })
  | (Bounds & { readonly left: SegmentIndex; readonly right: SegmentIndex });

export type PolylineDeviationBounds = {
  /** A sampled value that the continuous maximum is guaranteed to meet or exceed. */
  readonly lowerBound: number;
  /** A conservative bound that the continuous maximum is guaranteed not to exceed. */
  readonly upperBound: number;
};

/**
 * Bounds the symmetric continuous deviation between two polylines.
 *
 * Both directions are sampled across segment interiors, not just at vertices.
 * Point-to-polyline distances are exact. Since distance to a fixed polyline is
 * 1-Lipschitz, adding half of the largest realized sample interval gives a
 * conservative upper bound for the unsampled points between each pair.
 */
export function polylineDeviationBounds(
  first: ReadonlyArray<Vec2>,
  second: ReadonlyArray<Vec2>,
  maximumOracleError: number,
): PolylineDeviationBounds {
  assertUsablePolyline(first);
  assertUsablePolyline(second);
  if (!Number.isFinite(maximumOracleError) || maximumOracleError <= 0) {
    throw new Error('expected a positive finite oracle error');
  }

  const firstToSecond = directedDeviationBounds(
    first,
    buildSegmentIndex(segmentsOf(second)),
    maximumOracleError,
  );
  const secondToFirst = directedDeviationBounds(
    second,
    buildSegmentIndex(segmentsOf(first)),
    maximumOracleError,
  );
  return {
    lowerBound: Math.max(firstToSecond.lowerBound, secondToFirst.lowerBound),
    upperBound: Math.max(firstToSecond.upperBound, secondToFirst.upperBound),
  };
}

function directedDeviationBounds(
  source: ReadonlyArray<Vec2>,
  target: SegmentIndex,
  maximumOracleError: number,
): PolylineDeviationBounds {
  const maximumSampleSpacing = maximumOracleError * LIPSCHITZ_SAMPLE_SPACING_FACTOR;
  let lowerBound = 0;
  let largestRealizedSpacing = 0;
  for (let index = 1; index < source.length; index += 1) {
    const start = source[index - 1];
    const end = source[index];
    if (start === undefined || end === undefined) continue;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(length / maximumSampleSpacing));
    largestRealizedSpacing = Math.max(largestRealizedSpacing, length / steps);
    for (let step = 0; step <= steps; step += 1) {
      const fraction = step / steps;
      const point = {
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
      };
      lowerBound = Math.max(lowerBound, Math.sqrt(distanceSquaredToIndex(point, target)));
    }
  }
  return {
    lowerBound,
    upperBound: lowerBound + largestRealizedSpacing * MAXIMUM_SAMPLE_DISTANCE_FACTOR,
  };
}

function assertUsablePolyline(points: ReadonlyArray<Vec2>): void {
  if (points.length < MIN_POLYLINE_POINT_COUNT) {
    throw new Error('expected at least one polyline segment');
  }
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('expected finite polyline points');
  }
}

function segmentsOf(points: ReadonlyArray<Vec2>): IndexedSegment[] {
  const segments: IndexedSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start === undefined || end === undefined) continue;
    segments.push({
      start,
      end,
      minX: Math.min(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x),
      maxY: Math.max(start.y, end.y),
    });
  }
  return segments;
}

function buildSegmentIndex(segments: ReadonlyArray<IndexedSegment>): SegmentIndex {
  if (segments.length === 0) throw new Error('expected at least one indexed segment');
  const bounds = combinedBounds(segments);
  if (segments.length <= SEGMENT_LEAF_SIZE) return { ...bounds, segments };
  const splitOnX = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
  const sorted = [...segments].sort((first, second) => {
    const firstCenter = splitOnX ? first.minX + first.maxX : first.minY + first.maxY;
    const secondCenter = splitOnX ? second.minX + second.maxX : second.minY + second.maxY;
    return firstCenter - secondCenter;
  });
  const middle = Math.floor(sorted.length / 2);
  return {
    ...bounds,
    left: buildSegmentIndex(sorted.slice(0, middle)),
    right: buildSegmentIndex(sorted.slice(middle)),
  };
}

function combinedBounds(bounds: ReadonlyArray<Bounds>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const value of bounds) {
    minX = Math.min(minX, value.minX);
    minY = Math.min(minY, value.minY);
    maxX = Math.max(maxX, value.maxX);
    maxY = Math.max(maxY, value.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function distanceSquaredToIndex(point: Vec2, index: SegmentIndex, best = Infinity): number {
  if (distanceSquaredToBounds(point, index) >= best) return best;
  if ('segments' in index) {
    for (const segment of index.segments) {
      if (distanceSquaredToBounds(point, segment) < best) {
        best = Math.min(best, distanceSquaredToSegment(point, segment.start, segment.end));
      }
    }
    return best;
  }

  const leftDistance = distanceSquaredToBounds(point, index.left);
  const rightDistance = distanceSquaredToBounds(point, index.right);
  const nearer = leftDistance <= rightDistance ? index.left : index.right;
  const farther = leftDistance <= rightDistance ? index.right : index.left;
  best = distanceSquaredToIndex(point, nearer, best);
  return distanceSquaredToIndex(point, farther, best);
}

function distanceSquaredToBounds(point: Vec2, bounds: Bounds): number {
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
  const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY);
  return dx * dx + dy * dy;
}

function distanceSquaredToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= DEGENERATE_SEGMENT_EPSILON_SQUARED) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }
  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const fraction = Math.max(0, Math.min(1, projection));
  const px = point.x - (start.x + dx * fraction);
  const py = point.y - (start.y + dy * fraction);
  return px * px + py * py;
}
