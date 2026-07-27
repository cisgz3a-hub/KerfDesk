import { describe, expect, it } from 'vitest';
import { polylineDeviationBounds } from '../../__fixtures__/polyline-deviation-bounds';
import { polylineSegmentLengths } from '../../__fixtures__/polyline-distance';
import type { Vec2 } from '../scene';
import { fidelityResampleChain } from './fidelity-resample-chain';

const RADIUS_PX = 10;
const SAMPLE_COUNT = 360;
const LARGE_SAMPLE_COUNT = 27_000;
const MM_PER_PX = 0.02;
const TARGET_SEGMENT_MM = 0.4;
const MAX_DEVIATION_MM = 0.05;
const DEVIATION_ORACLE_ERROR_MM = 0.005;
const FLOAT_TOLERANCE_MM = 1e-6;
const FULL_TURN_RADIANS = Math.PI * 2;

function circle(sampleCount = SAMPLE_COUNT): Vec2[] {
  const points = Array.from({ length: sampleCount }, (_, index) => {
    const angle = (index / sampleCount) * FULL_TURN_RADIANS;
    return { x: RADIUS_PX * Math.cos(angle), y: RADIUS_PX * Math.sin(angle) };
  });
  const first = points[0];
  if (first === undefined) throw new Error('expected a circle start point');
  points.push({ x: first.x, y: first.y });
  return points;
}

function pointsInMm(points: ReadonlyArray<Vec2>): Vec2[] {
  return points.map((point) => ({ x: point.x * MM_PER_PX, y: point.y * MM_PER_PX }));
}

describe('fidelityResampleChain', () => {
  it('lets boundary fidelity win when the physical chord target is infeasible', () => {
    const source = circle();
    const result = fidelityResampleChain(
      source,
      source,
      TARGET_SEGMENT_MM / MM_PER_PX,
      MAX_DEVIATION_MM / MM_PER_PX,
    );

    const deviation = polylineDeviationBounds(
      pointsInMm(source),
      pointsInMm(result),
      DEVIATION_ORACLE_ERROR_MM,
    );
    expect(deviation.upperBound).toBeLessThanOrEqual(
      MAX_DEVIATION_MM + DEVIATION_ORACLE_ERROR_MM + FLOAT_TOLERANCE_MM,
    );
    expect(result.length).toBeLessThan(source.length);
    const segmentLengthsMm = polylineSegmentLengths({ points: result, closed: true }).map(
      (length) => length * MM_PER_PX,
    );
    expect(segmentLengthsMm.length).toBeGreaterThan(0);
    expect(Math.min(...segmentLengthsMm)).toBeLessThan(TARGET_SEGMENT_MM);
  });

  it('never inserts more segments than a coarse source contains', () => {
    const source: ReadonlyArray<Vec2> = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];

    const result = fidelityResampleChain(source, source, 0.001, 0.5);

    expect(result.length).toBeLessThanOrEqual(source.length);
  });

  it('returns the smoothed vertices when equal-count arclength samples still drift', () => {
    const source: ReadonlyArray<Vec2> = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 10, y: 0 },
    ];

    expect(fidelityResampleChain(source, source, 0.001, 0)).toEqual(source);
  });

  it('keeps adaptive work bounded on a 27k-point source ring', () => {
    const source = circle(LARGE_SAMPLE_COUNT);

    const result = fidelityResampleChain(
      source,
      source,
      TARGET_SEGMENT_MM / MM_PER_PX,
      MAX_DEVIATION_MM / MM_PER_PX,
    );

    expect(result.length).toBeLessThanOrEqual(source.length);
    expect(result.length).toBeGreaterThan(3);
  });
});
