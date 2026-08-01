import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../core/scene';
import { polylineDeviationBounds } from './polyline-deviation-bounds';
import { maximumPointDistanceToPolyline } from './polyline-distance';

const DEVIATION_ORACLE_ERROR_MM = 0.005;
const FULL_TURN_RADIANS = Math.PI * 2;
const ORACLE_CIRCLE_TRIANGLE_DEVIATION_FLOOR = 3;
const ORACLE_INTERIOR_MISMATCH_FLOOR = 0.5;
const ORACLE_REGRESSION_POINT_COUNT = 12;
const ORACLE_REGRESSION_RADIUS = 10;
const ORACLE_TRIANGLE_SECOND_INDEX = 4;
const ORACLE_TRIANGLE_THIRD_INDEX = 8;
const ORACLE_VERTEX_TOLERANCE = 1e-9;
const SHARED_VERTEX_PERIMETER: ReadonlyArray<Vec2> = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];
const SHARED_VERTEX_CROSSING: ReadonlyArray<Vec2> = [
  { x: -1, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

describe('polylineDeviationBounds', () => {
  it('measures segment-interior deviation that a vertex-only circle check misses', () => {
    const circlePoints = Array.from({ length: ORACLE_REGRESSION_POINT_COUNT }, (_, index): Vec2 => {
      const angle = (index / ORACLE_REGRESSION_POINT_COUNT) * FULL_TURN_RADIANS;
      return {
        x: Math.cos(angle) * ORACLE_REGRESSION_RADIUS,
        y: Math.sin(angle) * ORACLE_REGRESSION_RADIUS,
      };
    });
    const first = circlePoints[0];
    const triangleSecond = circlePoints[ORACLE_TRIANGLE_SECOND_INDEX];
    const triangleThird = circlePoints[ORACLE_TRIANGLE_THIRD_INDEX];
    if (first === undefined || triangleSecond === undefined || triangleThird === undefined) {
      throw new Error('expected oracle regression geometry');
    }
    const circle = [...circlePoints, first];
    const triangle = [first, triangleSecond, triangleThird, first];

    expect(maximumPointDistanceToPolyline(triangle, circle)).toBeLessThanOrEqual(
      ORACLE_VERTEX_TOLERANCE,
    );
    const deviation = polylineDeviationBounds(circle, triangle, DEVIATION_ORACLE_ERROR_MM);

    expect(deviation.lowerBound).toBeGreaterThan(ORACLE_CIRCLE_TRIANGLE_DEVIATION_FLOOR);
  });

  it('measures segment interiors when both polylines contain the same vertices', () => {
    expect(
      maximumPointDistanceToPolyline(SHARED_VERTEX_PERIMETER, SHARED_VERTEX_CROSSING),
    ).toBeLessThanOrEqual(ORACLE_VERTEX_TOLERANCE);
    expect(
      maximumPointDistanceToPolyline(SHARED_VERTEX_CROSSING, SHARED_VERTEX_PERIMETER),
    ).toBeLessThanOrEqual(ORACLE_VERTEX_TOLERANCE);

    const deviation = polylineDeviationBounds(
      SHARED_VERTEX_PERIMETER,
      SHARED_VERTEX_CROSSING,
      DEVIATION_ORACLE_ERROR_MM,
    );

    expect(deviation.lowerBound).toBeGreaterThan(ORACLE_INTERIOR_MISMATCH_FLOOR);
  });
});
