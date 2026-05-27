import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../core/scene';
import { DEFAULT_FLATNESS_MM, flattenArc, flattenCubic, flattenQuadratic } from './flatten-curves';

describe('flattenCubic', () => {
  it('emits just the endpoint for a flat curve (all 4 points collinear)', () => {
    const out: Vec2[] = [];
    flattenCubic(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      DEFAULT_FLATNESS_MM,
      out,
    );
    // Flat already → single endpoint
    expect(out).toEqual([{ x: 30, y: 0 }]);
  });

  it('subdivides a curved Bezier into many segments', () => {
    const out: Vec2[] = [];
    flattenCubic(
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      DEFAULT_FLATNESS_MM,
      out,
    );
    // S-curve with significant deviation → must be many segments
    expect(out.length).toBeGreaterThan(20);
    // Last point must equal the end
    expect(out[out.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('respects the tolerance: looser tolerance → fewer segments', () => {
    const tight: Vec2[] = [];
    const loose: Vec2[] = [];
    const args = [
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
    ] as const;
    flattenCubic(args[0], args[1], args[2], args[3], 0.1, tight);
    flattenCubic(args[0], args[1], args[2], args[3], 5, loose);
    expect(loose.length).toBeLessThan(tight.length);
  });
});

describe('flattenQuadratic', () => {
  it('produces a polyline starting from p0 + p2', () => {
    const out: Vec2[] = [];
    flattenQuadratic({ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }, DEFAULT_FLATNESS_MM, out);
    // Last point must equal the end
    expect(out[out.length - 1]).toEqual({ x: 100, y: 0 });
    // Curve through (50,25) approximately → some segments above y=0
    const aboveAxis = out.some((p) => p.y > 5);
    expect(aboveAxis).toBe(true);
  });
});

describe('flattenArc', () => {
  it('emits the endpoint when rx or ry is zero (degenerate)', () => {
    const out: Vec2[] = [];
    flattenArc(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { rx: 0, ry: 5, xAxisRotationDeg: 0, largeArc: false, sweep: true },
      DEFAULT_FLATNESS_MM,
      out,
    );
    expect(out).toEqual([{ x: 10, y: 10 }]);
  });

  it('produces a curved polyline from a quarter-turn arc', () => {
    const out: Vec2[] = [];
    // Quarter circle from (10,0) to (0,10) with rx=ry=10, sweep=true
    flattenArc(
      { x: 10, y: 0 },
      { x: 0, y: 10 },
      { rx: 10, ry: 10, xAxisRotationDeg: 0, largeArc: false, sweep: true },
      DEFAULT_FLATNESS_MM,
      out,
    );
    expect(out.length).toBeGreaterThan(5);
    expect(out[out.length - 1]?.x).toBeCloseTo(0);
    expect(out[out.length - 1]?.y).toBeCloseTo(10);
    // Every intermediate point should lie on the unit circle r=10.
    for (const p of out) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 1);
    }
  });
});
