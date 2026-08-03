import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import {
  detailPath3dPlan,
  detailPath3dPoints,
  type BoundarySegment,
  type DetailDepthLaw,
} from './vcarve-detail-depth';

const Z_TOLERANCE_MM = 0.02;

function ringEdge(lengthMm: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 1 },
      { x: lengthMm, y: 1 },
    ],
  };
}

function baseline(lengthMm: number): BoundarySegment {
  return { ax: 0, ay: 0, bx: lengthMm, by: 0 };
}

function pointBoundary(x: number, y: number): BoundarySegment {
  return { ax: x, ay: y, bx: x, by: y };
}

function shortBoundary(x: number, y: number, halfWidth = 0.05): BoundarySegment {
  return { ax: x - halfWidth, ay: y, bx: x + halfWidth, by: y };
}

function analyticZ(
  x: number,
  y: number,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - segment.ax) * dx + (y - segment.ay) * dy) / lengthSq));
    distance = Math.min(distance, Math.hypot(x - (segment.ax + t * dx), y - (segment.ay + t * dy)));
  }
  return -Math.min(distance / law.tanHalf, law.maxDepthMm);
}

function expectInterpolationWithinTolerance(
  points: ReturnType<typeof detailPath3dPoints>,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): void {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a === undefined || b === undefined) continue;
    for (let sample = 0; sample <= 32; sample += 1) {
      const t = sample / 32;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const emittedZ = a.z + (b.z - a.z) * t;
      const expectedZ = analyticZ(x, y, segments, law);
      expect(emittedZ).toBeGreaterThanOrEqual(expectedZ - 1e-9);
      expect(emittedZ - expectedZ).toBeLessThanOrEqual(Z_TOLERANCE_MM + 1e-9);
    }
  }
}

function expectNoGouge(
  points: ReturnType<typeof detailPath3dPoints>,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): void {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a === undefined || b === undefined) continue;
    for (let sample = 0; sample <= 32; sample += 1) {
      const t = sample / 32;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const emittedZ = a.z + (b.z - a.z) * t;
      expect(emittedZ).toBeGreaterThanOrEqual(analyticZ(x, y, segments, law) - 1e-9);
    }
  }
}

describe('detailPath3dPoints', () => {
  it('finds multiple hidden boundary-distance minima along one ring edge', () => {
    const segments = [baseline(10), shortBoundary(2.5, 0.98), shortBoundary(7.5, 0.98)];
    const law = { tanHalf: 1, maxDepthMm: 2 };
    const plan = detailPath3dPlan(ringEdge(10), segments, law);
    expect(plan.toleranceMet).toBe(true);
    expect(plan.points.length).toBeLessThan(2_000);
    expect(plan.points.some((point) => point.x === 2.5 && point.z >= -0.02)).toBe(true);
    expect(plan.points.some((point) => point.x === 7.5 && point.z >= -0.02)).toBe(true);
    expectInterpolationWithinTolerance(plan.points, segments, law);
  });

  it('refines a narrow-angle depth knee inside the former 0.05 mm stop span', () => {
    const segments = [baseline(0.04), shortBoundary(0.01, 0.9999, 0.0001)];
    const law = { tanHalf: Math.tan((0.5 * Math.PI) / 180), maxDepthMm: 0.05 };
    const plan = detailPath3dPlan(ringEdge(0.04), segments, law);
    expect(plan.toleranceMet).toBe(false);
    expect(plan.points.length).toBeLessThan(200);
    for (let index = 1; index < plan.points.length - 1; index += 1) {
      const previous = plan.points[index - 1];
      const point = plan.points[index];
      if (previous === undefined || point === undefined) continue;
      expect(`${point.x.toFixed(3)},${point.y.toFixed(3)}`).not.toBe(
        `${previous.x.toFixed(3)},${previous.y.toFixed(3)}`,
      );
    }
    expectNoGouge(plan.points, segments, law);
  });

  it('keeps the tolerance on a span longer than the former recursion budget', () => {
    const segments = [baseline(100), pointBoundary(50, 0.9)];
    const law = { tanHalf: 1, maxDepthMm: 2 };
    const points = detailPath3dPoints(ringEdge(100), segments, law);
    expect(points.length).toBeLessThan(700);
    expect(points.some((point) => point.x === 50 && point.z > -0.1)).toBe(true);
    expectInterpolationWithinTolerance(points, segments, law);
  });

  it('uses stitched leaf minima so a convex distance profile never gouges', () => {
    const edge: Polyline = {
      closed: true,
      points: [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
      ],
    };
    const segments = [pointBoundary(0, 1)];
    const law = { tanHalf: 1, maxDepthMm: 2 };
    const plan = detailPath3dPlan(edge, segments, law);
    expect(plan.toleranceMet).toBe(true);
    expectInterpolationWithinTolerance(plan.points, segments, law);
  });

  it('keeps the no-gouge and undercut bounds after 0.001 mm XYZ formatting', () => {
    const segments = [baseline(10), shortBoundary(2.5, 0.98), shortBoundary(7.5, 0.98)];
    const law = { tanHalf: 1, maxDepthMm: 2 };
    const plan = detailPath3dPlan(ringEdge(10), segments, law);
    expect(plan.points.length).toBeLessThan(2_000);
    const emitted = plan.points.map((point) => ({
      x: Number(point.x.toFixed(3)),
      y: Number(point.y.toFixed(3)),
      z: Number(point.z.toFixed(3)),
    }));
    expect(plan.toleranceMet).toBe(true);
    expectInterpolationWithinTolerance(emitted, segments, law);
  });

  it('does not certify an unsampled boundary-distance peak between quarter probes', () => {
    const segments: ReadonlyArray<BoundarySegment> = [
      { ax: 0, ay: 0.99, bx: 0.9, by: 0.99 },
      { ax: 1.1, ay: 0.99, bx: 10, by: 0.99 },
    ];
    const law = { tanHalf: 1, maxDepthMm: 2 };
    const plan = detailPath3dPlan(ringEdge(10), segments, law);

    expect(plan.toleranceMet).toBe(true);
    expect(plan.points.length).toBeGreaterThan(2);
    expectInterpolationWithinTolerance(plan.points, segments, law);
  });
});
