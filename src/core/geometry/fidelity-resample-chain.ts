import type { Vec2 } from '../scene';

const MIN_CHAIN_POINT_COUNT = 2;
const RELATIVE_DEVIATION_EPSILON = 1e-9;
const RESOLUTION_GROWTH_FACTOR = 2;

type ResampledPoint = {
  readonly point: Vec2;
  readonly sourceSegmentStart: number;
  readonly sourceFraction: number;
};

/**
 * Resample a smoothed chain toward the requested chord length without
 * exceeding the original source boundary's deviation budget.
 *
 * Resolution doubles only when the target would cut too far across the
 * source. The source segment count is the ceiling, so coarse inputs are never
 * densified. If equal-count arclength samples still exceed the cap, the
 * already-clamped smoothed chain is returned without shifting its vertices.
 */
export function fidelityResampleChain(
  smoothed: ReadonlyArray<Vec2>,
  source: ReadonlyArray<Vec2>,
  targetSegmentLength: number,
  maxDeviation: number,
): Vec2[] {
  if (smoothed.length < MIN_CHAIN_POINT_COUNT || smoothed.length !== source.length) {
    return [...smoothed];
  }
  const cumulative = cumulativeLengths(smoothed);
  const total = requiredNumber(cumulative, cumulative.length - 1);
  const sourceSegmentCount = smoothed.length - 1;
  let segmentCount = Math.max(
    1,
    Math.min(sourceSegmentCount, Math.floor(total / targetSegmentLength)),
  );
  let samples = resampleWithSegmentCount(smoothed, cumulative, total, segmentCount);
  const allowedDeviation = maxDeviation + Math.abs(maxDeviation) * RELATIVE_DEVIATION_EPSILON;
  while (!alignedBoundaryFits(source, samples, allowedDeviation)) {
    if (segmentCount >= sourceSegmentCount) return [...smoothed];
    segmentCount = Math.min(
      sourceSegmentCount,
      Math.max(segmentCount + 1, segmentCount * RESOLUTION_GROWTH_FACTOR),
    );
    samples = resampleWithSegmentCount(smoothed, cumulative, total, segmentCount);
  }
  return samples.map(({ point }) => point);
}

function cumulativeLengths(points: ReadonlyArray<Vec2>): number[] {
  const cumulative: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const start = requiredPoint(points, index - 1);
    const end = requiredPoint(points, index);
    cumulative.push(
      requiredNumber(cumulative, index - 1) + Math.hypot(end.x - start.x, end.y - start.y),
    );
  }
  return cumulative;
}

function resampleWithSegmentCount(
  chain: ReadonlyArray<Vec2>,
  cumulative: ReadonlyArray<number>,
  total: number,
  segmentCount: number,
): ResampledPoint[] {
  const first = requiredPoint(chain, 0);
  const last = requiredPoint(chain, chain.length - 1);
  const out: ResampledPoint[] = [
    { point: { x: first.x, y: first.y }, sourceSegmentStart: 0, sourceFraction: 0 },
  ];
  let cursor = 1;
  for (let sampleIndex = 1; sampleIndex < segmentCount; sampleIndex += 1) {
    const target = (sampleIndex * total) / segmentCount;
    while (cursor < cumulative.length - 1 && requiredNumber(cumulative, cursor) < target) {
      cursor += 1;
    }
    const segmentStartLength = requiredNumber(cumulative, cursor - 1);
    const segmentEndLength = requiredNumber(cumulative, cursor);
    const fraction =
      segmentEndLength > segmentStartLength
        ? (target - segmentStartLength) / (segmentEndLength - segmentStartLength)
        : 0;
    out.push({
      point: interpolateSegment(chain, cursor - 1, fraction),
      sourceSegmentStart: cursor - 1,
      sourceFraction: fraction,
    });
  }
  out.push({
    point: { x: last.x, y: last.y },
    sourceSegmentStart: chain.length - MIN_CHAIN_POINT_COUNT,
    sourceFraction: 1,
  });
  return out;
}

// Each source interval corresponds to one output chord. Distance to that
// chord is convex along every source segment, so its endpoints bound the full
// piecewise-linear interval; no all-pairs scan is needed.
function alignedBoundaryFits(
  source: ReadonlyArray<Vec2>,
  samples: ReadonlyArray<ResampledPoint>,
  maxDeviation: number,
): boolean {
  for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
    const start = samples[sampleIndex - 1];
    const end = samples[sampleIndex];
    if (start === undefined || end === undefined) return false;
    if (
      distanceToSegment(
        interpolateSegment(source, start.sourceSegmentStart, start.sourceFraction),
        start.point,
        end.point,
      ) > maxDeviation
    ) {
      return false;
    }
    if (end.sourceSegmentStart > start.sourceSegmentStart) {
      for (
        let sourceIndex = start.sourceSegmentStart + 1;
        sourceIndex <= end.sourceSegmentStart;
        sourceIndex += 1
      ) {
        if (
          distanceToSegment(requiredPoint(source, sourceIndex), start.point, end.point) >
          maxDeviation
        ) {
          return false;
        }
      }
    }
    if (
      distanceToSegment(
        interpolateSegment(source, end.sourceSegmentStart, end.sourceFraction),
        start.point,
        end.point,
      ) > maxDeviation
    ) {
      return false;
    }
  }
  return true;
}

function interpolateSegment(points: ReadonlyArray<Vec2>, segmentStart: number, t: number): Vec2 {
  const start = requiredPoint(points, segmentStart);
  const end = requiredPoint(points, segmentStart + 1);
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const fraction = Math.max(0, Math.min(1, projection));
  return Math.hypot(point.x - (start.x + dx * fraction), point.y - (start.y + dy * fraction));
}

function requiredPoint(points: ReadonlyArray<Vec2>, index: number): Vec2 {
  const point = points[index];
  if (point === undefined) throw new Error('invalid fidelity resampling point');
  return point;
}

function requiredNumber(values: ReadonlyArray<number>, index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error('invalid fidelity resampling length');
  return value;
}
