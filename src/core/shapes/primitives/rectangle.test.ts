import { describe, expect, it } from 'vitest';
import { rectangleToPolylines } from './rectangle';

describe('rectangleToPolylines', () => {
  it('produces a sharp rectangle as a 5-point loop (corners + repeated first)', () => {
    const [polyline, ...rest] = rectangleToPolylines({
      widthMm: 80,
      heightMm: 50,
      cornerRadiusMm: 0,
    });
    expect(rest).toHaveLength(0);
    expect(polyline?.closed).toBe(true);
    // The first point repeats at the end so the stroke renderer (no closePath)
    // draws the closing edge — matches io/svg/shape-to-polylines's convention.
    expect(polyline?.points).toEqual([
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 50 },
      { x: 0, y: 50 },
      { x: 0, y: 0 },
    ]);
  });

  it('treats a non-positive or non-finite corner radius as sharp', () => {
    expect(
      rectangleToPolylines({ widthMm: 10, heightMm: 10, cornerRadiusMm: -5 })[0]?.points,
    ).toHaveLength(5);
    expect(
      rectangleToPolylines({ widthMm: 10, heightMm: 10, cornerRadiusMm: NaN })[0]?.points,
    ).toHaveLength(5);
  });

  it('rounds the corners with arcs that stay inside the rectangle bounds', () => {
    const [polyline] = rectangleToPolylines({ widthMm: 80, heightMm: 50, cornerRadiusMm: 10 });
    const points = polyline?.points ?? [];
    expect(polyline?.closed).toBe(true);
    // Four quarter arcs at 8 segments each = 4 * 9 points, plus the repeated
    // first point that closes the loop.
    expect(points).toHaveLength(37);
    expect(points[points.length - 1]).toEqual(points[0]);
    // Every point lies within the [0,80] x [0,50] box (no overshoot).
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(80);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(50);
    }
    // The outline reaches each edge (the arcs touch x=0/80 and y=0/50).
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(0);
    expect(Math.max(...points.map((p) => p.x))).toBeCloseTo(80);
    expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0);
    expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(50);
  });

  it('clamps the radius to half the shorter side (square becomes a circle)', () => {
    const [polyline] = rectangleToPolylines({ widthMm: 20, heightMm: 20, cornerRadiusMm: 50 });
    const points = polyline?.points ?? [];
    // Radius clamps to 10; the outline is a circle inscribed in the 20x20 box,
    // so every point is ~10 mm from the center (10, 10).
    for (const p of points) {
      const dist = Math.hypot(p.x - 10, p.y - 10);
      expect(dist).toBeCloseTo(10);
    }
  });
});
