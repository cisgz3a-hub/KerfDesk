// fit-cubics tests — the fairing-by-fitting stage (research brief #2, rec 1).
// Least-squares G1 cubic fitting over measured boundary points IS the
// smoothing: fitting averages ~0.1px measurement noise into fair curves
// without chord-replacement joints or facet shimmer.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { fitCubicsThroughPoints, sampleCubics } from './fit-cubics';

const FIT_TOLERANCE_PX = 0.4;

function circlePoints(radius: number, count: number, noise = 0): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * 2 * Math.PI;
    // Deterministic pseudo-noise (no RNG in tests): alternating radial nudge.
    const r = radius + (i % 2 === 0 ? noise : -noise);
    points.push({ x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) });
  }
  return points;
}

function maxDistanceToCircle(points: ReadonlyArray<Vec2>, radius: number): number {
  let worst = 0;
  for (const p of points) {
    worst = Math.max(worst, Math.abs(Math.hypot(p.x - 100, p.y - 100) - radius));
  }
  return worst;
}

describe('fitCubicsThroughPoints', () => {
  it('fits a clean circle with few segments and sub-tolerance deviation', () => {
    const points = circlePoints(40, 240);
    const cubics = fitCubicsThroughPoints(points, true, new Set(), FIT_TOLERANCE_PX);
    expect(cubics.length).toBeLessThanOrEqual(12);
    const sampled = sampleCubics(cubics, true);
    expect(maxDistanceToCircle(sampled, 40)).toBeLessThanOrEqual(FIT_TOLERANCE_PX + 0.1);
  });

  it('averages small measurement noise instead of reproducing it (fairing)', () => {
    const noisy = circlePoints(40, 240, 0.12);
    const cubics = fitCubicsThroughPoints(noisy, true, new Set(), FIT_TOLERANCE_PX);
    const sampled = sampleCubics(cubics, true);
    // The fitted curve should sit CLOSER to the true circle than the noise
    // amplitude — least squares averages it away.
    expect(maxDistanceToCircle(sampled, 40)).toBeLessThanOrEqual(0.35);
  });

  it('keeps marked corners exact and breaks tangency there', () => {
    // An L: two straight legs meeting at a right angle.
    const points: Vec2[] = [];
    for (let i = 0; i <= 40; i += 1) points.push({ x: i, y: 0 });
    for (let i = 1; i <= 40; i += 1) points.push({ x: 40, y: i });
    const corner = points[40]!;
    const cubics = fitCubicsThroughPoints(points, false, new Set([corner]), FIT_TOLERANCE_PX);
    const sampled = sampleCubics(cubics, false);
    const atCorner = sampled.some((p) => Math.hypot(p.x - 40, p.y - 0) < 1e-6);
    expect(atCorner).toBe(true);
    // Every sampled point stays on the L within tolerance (no corner rounding).
    for (const p of sampled) {
      const onLeg = Math.min(Math.abs(p.y), Math.abs(p.x - 40));
      expect(onLeg).toBeLessThanOrEqual(FIT_TOLERANCE_PX + 0.05);
    }
  });

  it('fits a straight run as a single degenerate cubic', () => {
    const points: Vec2[] = [];
    for (let i = 0; i <= 60; i += 1) points.push({ x: i, y: 5 });
    const cubics = fitCubicsThroughPoints(points, false, new Set(), FIT_TOLERANCE_PX);
    expect(cubics.length).toBe(1);
    const sampled = sampleCubics(cubics, false);
    for (const p of sampled) expect(Math.abs(p.y - 5)).toBeLessThanOrEqual(0.05);
  });

  it('returns the input shape for degenerate tiny chains', () => {
    const tiny: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    const cubics = fitCubicsThroughPoints(tiny, false, new Set(), FIT_TOLERANCE_PX);
    const sampled = sampleCubics(cubics, false);
    expect(sampled.length).toBeGreaterThanOrEqual(2);
    expect(sampled[0]).toEqual({ x: 0, y: 0 });
    expect(sampled[sampled.length - 1]).toEqual({ x: 1, y: 0 });
  });
});
