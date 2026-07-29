import { describe, expect, it } from 'vitest';

import type { Vec2 } from '../../core/scene';
import { sampleSpline, type SplineData } from './dxf-spline';

function sampledPoints(spline: SplineData): ReadonlyArray<Vec2> {
  const result = sampleSpline(spline, { toleranceMm: 0.025 });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.points;
}

function distanceToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function distanceToPolyline(point: Vec2, polyline: ReadonlyArray<Vec2>): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    closest = Math.min(
      closest,
      distanceToSegment(point, polyline[index - 1] as Vec2, polyline[index] as Vec2),
    );
  }
  return closest;
}

function polynomialProduct(roots: ReadonlyArray<number>): number[] {
  return roots.reduce<number[]>(
    (coefficients, root) => {
      const next = Array.from({ length: coefficients.length + 1 }, () => 0);
      for (let index = 0; index < coefficients.length; index += 1) {
        next[index] = (next[index] as number) - root * (coefficients[index] as number);
        next[index + 1] = (next[index + 1] as number) + (coefficients[index] as number);
      }
      return next;
    },
    [1],
  );
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index;
  return result;
}

function powerToBernstein(coefficients: ReadonlyArray<number>): number[] {
  const degree = coefficients.length - 1;
  return Array.from({ length: degree + 1 }, (_, index) => {
    let value = 0;
    for (let power = 0; power <= index; power += 1) {
      value += ((coefficients[power] as number) * binomial(index, power)) / binomial(degree, power);
    }
    return value;
  });
}

describe('flattenSplineToTolerance', () => {
  it('certifies a degree-8 between-probe arch with an independent analytic oracle', () => {
    const scale = 40_000;
    const polynomial = polynomialProduct([0, 1, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75]).map(
      (coefficient) => coefficient * scale,
    );
    const yControls = powerToBernstein(polynomial);
    const degree = yControls.length - 1;
    const spline: SplineData = {
      degree,
      knots: [...Array(degree + 1).fill(0), ...Array(degree + 1).fill(1)],
      controlPoints: yControls.map((y, index) => ({ x: (10 * index) / degree, y })),
      weights: [],
      closed: false,
    };
    const t = 0.1;
    const exactPoint = {
      x: 10 * t,
      y: scale * t * (t - 1) * (t - 0.25) ** 2 * (t - 0.5) ** 2 * (t - 0.75) ** 2,
    };
    expect(Math.abs(exactPoint.y)).toBeGreaterThan(5);
    expect(distanceToPolyline(exactPoint, sampledPoints(spline))).toBeLessThanOrEqual(0.025 + 1e-9);
  });

  it('preserves a late curved span after more than 4096 earlier spans', () => {
    const spanCount = 5_001;
    const spline: SplineData = {
      degree: 2,
      knots: [
        0,
        0,
        0,
        ...Array.from({ length: spanCount - 1 }, (_, index) => index + 1).flatMap((value) => [
          value,
          value,
        ]),
        spanCount,
        spanCount,
        spanCount,
      ],
      controlPoints: Array.from({ length: spanCount * 2 + 1 }, (_, index) => ({
        x: index / 2,
        y: index % 2 === 1 && index === spanCount * 2 - 1 ? 10 : 0,
      })),
      weights: [],
      closed: false,
    };
    expect(
      distanceToPolyline({ x: spanCount - 0.5, y: 5 }, sampledPoints(spline)),
    ).toBeLessThanOrEqual(0.025 + 1e-9);
  });
});
