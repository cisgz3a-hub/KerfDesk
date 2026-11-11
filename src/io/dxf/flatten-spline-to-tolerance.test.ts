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

  // Oracle O2-P1-1: the closed form of a uniform cubic B-spline, not this
  // module. With integer knots, the curve at knot k is
  // (P[k-3] + 4 P[k-2] + P[k-1]) / 6 and halfway to the next knot it is
  // (P[k-3] + 23 P[k-2] + 23 P[k-1] + P[k]) / 48. An unclamped curve does not
  // start or end on a control point.
  function uniformCubicOracle(controls: ReadonlyArray<Vec2>): Vec2[] {
    const at = (index: number) => controls[index] as Vec2;
    const points: Vec2[] = [];
    for (let k = 3; k < controls.length; k += 1) {
      points.push({
        x: (at(k - 3).x + 4 * at(k - 2).x + at(k - 1).x) / 6,
        y: (at(k - 3).y + 4 * at(k - 2).y + at(k - 1).y) / 6,
      });
      points.push({
        x: (at(k - 3).x + 23 * at(k - 2).x + 23 * at(k - 1).x + at(k).x) / 48,
        y: (at(k - 3).y + 23 * at(k - 2).y + 23 * at(k - 1).y + at(k).y) / 48,
      });
    }
    const last = controls.length;
    points.push({
      x: (at(last - 3).x + 4 * at(last - 2).x + at(last - 1).x) / 6,
      y: (at(last - 3).y + 4 * at(last - 2).y + at(last - 1).y) / 6,
    });
    return points;
  }

  it('starts and ends an open unclamped (uniform) cubic where the B-spline does', () => {
    const controlPoints = [
      { x: 0, y: 0 },
      { x: 30, y: 60 },
      { x: 60, y: -30 },
      { x: 90, y: 30 },
      { x: 120, y: 0 },
    ];
    const points = sampledPoints({
      degree: 3,
      knots: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      controlPoints,
      weights: [],
      closed: false,
    });
    const oracle = uniformCubicOracle(controlPoints);
    expect(points[0]?.x).toBeCloseTo(oracle[0]?.x as number, 9);
    expect(points[0]?.y).toBeCloseTo(oracle[0]?.y as number, 9);
    expect(points.at(-1)?.x).toBeCloseTo(oracle.at(-1)?.x as number, 9);
    expect(points.at(-1)?.y).toBeCloseTo(oracle.at(-1)?.y as number, 9);
    for (const point of oracle) {
      expect(distanceToPolyline(point, points)).toBeLessThanOrEqual(0.025 + 1e-9);
    }
  });

  it('closes a periodic cubic written with wrapped controls and unclamped knots', () => {
    // How ezdxf's set_closed() and AutoCAD's default closed SPLINE store a
    // periodic curve: the first `degree` controls repeated at the end and a
    // uniform knot vector with no repeated end knots.
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const controlPoints = [...square, ...square.slice(0, 3)];
    const points = sampledPoints({
      degree: 3,
      knots: Array.from({ length: controlPoints.length + 4 }, (_, index) => index),
      controlPoints,
      weights: [],
      closed: true,
    });
    const oracle = uniformCubicOracle(controlPoints);
    expect(points[0]?.x).toBeCloseTo(25 / 3, 9);
    expect(points[0]?.y).toBeCloseTo(5 / 3, 9);
    expect(
      Math.hypot(
        (points.at(-1)?.x as number) - (points[0]?.x as number),
        (points.at(-1)?.y as number) - (points[0]?.y as number),
      ),
    ).toBeLessThan(1e-9);
    for (const point of oracle) {
      expect(distanceToPolyline(point, points)).toBeLessThanOrEqual(0.025 + 1e-9);
    }
    // The curve stays inside the control square's hull (x in [5/12, 115/12]).
    const xs = points.map((point) => point.x);
    expect(Math.min(...xs)).toBeGreaterThan(0.4);
    expect(Math.max(...xs)).toBeLessThan(9.6);
  });
});
