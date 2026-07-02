import { describe, expect, it } from 'vitest';
import { bulgeSegment, sampleArc, sampleCircle, sampleEllipse } from './dxf-curve-sampling';

describe('bulgeSegment', () => {
  it('a quarter-circle bulge stays on the analytic circle', () => {
    // bulge = tan(sweep/4); 90° CCW from (0,0) to (10,0) arcs around (5,5).
    const bulge = Math.tan(Math.PI / 8);
    const points = bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, bulge);
    const radius = Math.hypot(5, 5);
    for (const point of points) {
      expect(Math.hypot(point.x - 5, point.y - 5)).toBeCloseTo(radius, 6);
    }
    expect(points.at(-1)).toEqual({ x: 10, y: 0 });
  });

  it('a negative bulge arcs to the other side of the chord', () => {
    const bulge = -Math.tan(Math.PI / 8);
    const points = bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, bulge);
    // CW quarter arc around (5,-5): every point on that circle, and the
    // whole arc sits ABOVE the chord (positive y) — the mirror of the
    // positive-bulge case.
    const radius = Math.hypot(5, 5);
    for (const point of points) {
      expect(Math.hypot(point.x - 5, point.y + 5)).toBeCloseTo(radius, 6);
      expect(point.y).toBeGreaterThanOrEqual(0);
    }
    // Sampled apex reaches the sagitta within the 0.05 mm chord tolerance.
    const maxY = Math.max(...points.map((p) => p.y));
    expect(Math.abs(maxY - (Math.abs(bulge) * 10) / 2)).toBeLessThanOrEqual(0.06);
  });

  it('zero bulge degenerates to the straight segment end', () => {
    expect(bulgeSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toEqual([{ x: 10, y: 0 }]);
  });
});

describe('sampleArc / sampleCircle', () => {
  it('includes both endpoints and stays on radius', () => {
    const points = sampleArc({ x: 0, y: 0 }, 10, 0, Math.PI / 2);
    expect(points[0]?.x).toBeCloseTo(10, 9);
    expect(points[0]?.y).toBeCloseTo(0, 9);
    expect(points.at(-1)?.x).toBeCloseTo(0, 9);
    expect(points.at(-1)?.y).toBeCloseTo(10, 9);
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(10, 9);
    }
  });

  it('sampleCircle drops the seam duplicate', () => {
    const points = sampleCircle({ x: 0, y: 0 }, 5);
    expect(points[0]).not.toEqual(points.at(-1));
    for (const point of points) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(5, 9);
    }
  });
});

describe('sampleEllipse', () => {
  // Sampled extremes land within the documented 0.05 mm chord tolerance of
  // the analytic axes (a parameter-step sample rarely hits the exact apex).
  const EXTREME_TOLERANCE_MM = 0.06;

  it('a full ellipse hits the four analytic extremes', () => {
    const points = sampleEllipse({ x: 0, y: 0 }, { x: 20, y: 0 }, 0.5, 0, Math.PI * 2);
    const maxX = Math.max(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));
    expect(Math.abs(maxX - 20)).toBeLessThanOrEqual(EXTREME_TOLERANCE_MM);
    expect(Math.abs(maxY - 10)).toBeLessThanOrEqual(EXTREME_TOLERANCE_MM);
  });

  it('honors a rotated major axis', () => {
    // Major axis along +Y: the ellipse is tall, not wide.
    const points = sampleEllipse({ x: 0, y: 0 }, { x: 0, y: 20 }, 0.5, 0, Math.PI * 2);
    const maxX = Math.max(...points.map((p) => p.x));
    const maxY = Math.max(...points.map((p) => p.y));
    expect(Math.abs(maxY - 20)).toBeLessThanOrEqual(EXTREME_TOLERANCE_MM);
    expect(Math.abs(maxX - 10)).toBeLessThanOrEqual(EXTREME_TOLERANCE_MM);
  });
});
