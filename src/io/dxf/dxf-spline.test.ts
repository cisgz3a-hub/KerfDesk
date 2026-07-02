import { describe, expect, it } from 'vitest';
import { sampleSpline } from './dxf-spline';

describe('sampleSpline (clean-room de Boor)', () => {
  it('a clamped degree-2 spline matches the quadratic Bézier it encodes', () => {
    const result = sampleSpline({
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      weights: [],
      closed: false,
    });
    if (result.kind !== 'ok') throw new Error(result.reason);
    const points = result.points;
    // Clamped ends interpolate the first/last control points.
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 10, y: 10 });
    // Bézier at t=0.5: 0.25·P0 + 0.5·P1 + 0.25·P2 = (7.5, 2.5).
    const mid = points[Math.floor(points.length / 2)];
    expect(mid?.x).toBeCloseTo(7.5, 9);
    expect(mid?.y).toBeCloseTo(2.5, 9);
  });

  it('a degree-1 spline reproduces its control polygon', () => {
    const result = sampleSpline({
      degree: 1,
      knots: [0, 0, 1, 2, 2],
      controlPoints: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      weights: [],
      closed: false,
    });
    if (result.kind !== 'ok') throw new Error(result.reason);
    for (const point of result.points) {
      // Every sample lies on one of the two segments.
      const onFirst = Math.abs(point.y) < 1e-9 && point.x >= -1e-9 && point.x <= 10 + 1e-9;
      const onSecond = Math.abs(point.x - 10) < 1e-9 && point.y >= -1e-9 && point.y <= 10 + 1e-9;
      expect(onFirst || onSecond).toBe(true);
    }
  });

  it('a rational quarter-circle NURBS stays on the radius everywhere', () => {
    const result = sampleSpline({
      degree: 2,
      knots: [0, 0, 0, 1, 1, 1],
      controlPoints: [
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      weights: [1, Math.SQRT1_2, 1],
      closed: false,
    });
    if (result.kind !== 'ok') throw new Error(result.reason);
    for (const point of result.points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 9);
    }
  });

  it('rejects mismatched knot vectors and degenerate degrees with reasons', () => {
    const base = {
      controlPoints: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      weights: [],
      closed: false,
    };
    expect(sampleSpline({ ...base, degree: 2, knots: [0, 0, 0, 1] }).kind).toBe('error');
    expect(sampleSpline({ ...base, degree: 0, knots: [0, 0, 0, 1, 1, 1] }).kind).toBe('error');
    expect(sampleSpline({ ...base, degree: 2, knots: [0, 0, 0, 0, 0, 0] }).kind).toBe('error');
  });
});
