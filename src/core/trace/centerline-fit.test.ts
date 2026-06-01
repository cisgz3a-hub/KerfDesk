import { describe, expect, it } from 'vitest';

import type { Vec2 } from '../scene';
import { fitCenterlinePoints } from './centerline-fit';

function stairArcPoints(): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= 22; i += 1) {
    const t = i / 22;
    const angle = -Math.PI / 2 + t * (Math.PI / 2);
    const point = {
      x: Math.round(18 + 14 * Math.cos(angle)),
      y: Math.round(18 + 14 * Math.sin(angle)),
    };
    const prev = points[points.length - 1];
    if (prev === undefined || prev.x !== point.x || prev.y !== point.y) points.push(point);
  }
  return points;
}

function maxTurnDeg(points: ReadonlyArray<Vec2>): number {
  let max = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    if (a === undefined || b === undefined || c === undefined) continue;
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    const ul = Math.hypot(ux, uy);
    const vl = Math.hypot(vx, vy);
    if (ul === 0 || vl === 0) continue;
    const dot = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (ul * vl)));
    max = Math.max(max, (Math.acos(dot) * 180) / Math.PI);
  }
  return max;
}

function hasPointNear(points: ReadonlyArray<Vec2>, expected: Vec2, tolerance = 1e-6): boolean {
  return points.some(
    (point) => Math.hypot(point.x - expected.x, point.y - expected.y) <= tolerance,
  );
}

describe('fitCenterlinePoints', () => {
  it('keeps exact straight centerlines as one straight segment', () => {
    const points = Array.from({ length: 18 }, (_, i) => ({ x: i + 2, y: 7 }));

    const fitted = fitCenterlinePoints(points, {
      fitTolerancePx: 0.5,
      linearTolerancePx: 0.05,
      sampleStepPx: 4,
    });

    expect(fitted).toEqual([
      { x: 2, y: 7 },
      { x: 19, y: 7 },
    ]);
  });

  it('fits stair-stepped arcs into smooth sampled centerlines', () => {
    const points = stairArcPoints();

    const fitted = fitCenterlinePoints(points, {
      fitTolerancePx: 1.1,
      linearTolerancePx: 0.05,
      sampleStepPx: 4,
    });

    expect(fitted.length).toBeLessThan(points.length);
    expect(maxTurnDeg(fitted)).toBeLessThan(35);
    expect(fitted[0]).toEqual(points[0]);
    expect(fitted[fitted.length - 1]).toEqual(points[points.length - 1]);
  });

  it('preserves real sharp corners while fitting each side', () => {
    const points: Vec2[] = [];
    for (let x = 0; x <= 10; x += 1) points.push({ x, y: 0 });
    for (let y = 1; y <= 10; y += 1) points.push({ x: 10, y });

    const fitted = fitCenterlinePoints(points, {
      cornerAngleDeg: 45,
      fitTolerancePx: 0.5,
      linearTolerancePx: 0.05,
      sampleStepPx: 4,
    });

    expect(fitted).toHaveLength(3);
    expect(hasPointNear(fitted, { x: 10, y: 0 })).toBe(true);
  });
});
