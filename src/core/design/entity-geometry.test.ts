import { describe, expect, it } from 'vitest';
import { entityToPolylines } from './entity-geometry';
import type { SketchArc, SketchCircle, SketchPath, SketchRectangle } from './sketch-entity';

const TOLERANCE_MM = 1e-6;

describe('entityToPolylines — line', () => {
  it('is a two-point open polyline through the exact endpoints', () => {
    const [polyline] = entityToPolylines({
      kind: 'line',
      id: 'l1',
      start: { x: 1, y: 2 },
      end: { x: 11, y: 2 },
    });
    expect(polyline?.closed).toBe(false);
    expect(polyline?.points).toEqual([
      { x: 1, y: 2 },
      { x: 11, y: 2 },
    ]);
  });
});

describe('entityToPolylines — circle', () => {
  const circle: SketchCircle = {
    kind: 'circle',
    id: 'c1',
    center: { x: 5, y: -3 },
    radiusMm: 10,
  };

  it('puts every sampled point on the circle', () => {
    const [polyline] = entityToPolylines(circle);
    expect(polyline?.closed).toBe(true);
    for (const point of polyline?.points ?? []) {
      expect(Math.hypot(point.x - 5, point.y + 3)).toBeCloseTo(10, 6);
    }
  });

  it('does not repeat the first point as the last — closure is the flag', () => {
    const [polyline] = entityToPolylines(circle);
    const points = polyline?.points ?? [];
    const first = points[0];
    const last = points[points.length - 1];
    expect(points.length).toBeGreaterThan(8);
    expect(Math.hypot(first!.x - last!.x, first!.y - last!.y)).toBeGreaterThan(TOLERANCE_MM);
  });
});

describe('entityToPolylines — arc', () => {
  const quarter: SketchArc = {
    kind: 'arc',
    id: 'a1',
    center: { x: 0, y: 0 },
    radiusMm: 10,
    startAngleDeg: 0,
    sweepDeg: 90,
  };

  it('is open and starts and ends on the swept endpoints', () => {
    const [polyline] = entityToPolylines(quarter);
    const points = polyline?.points ?? [];
    expect(polyline?.closed).toBe(false);
    expect(points[0]?.x).toBeCloseTo(10, 6);
    expect(points[0]?.y).toBeCloseTo(0, 6);
    expect(points[points.length - 1]?.x).toBeCloseTo(0, 6);
    expect(points[points.length - 1]?.y).toBeCloseTo(10, 6);
  });

  it('sweeps counter-clockwise for a positive sweep and clockwise for a negative one', () => {
    const [ccw] = entityToPolylines(quarter);
    const [cw] = entityToPolylines({ ...quarter, sweepDeg: -90 });
    expect(ccw?.points[1]?.y).toBeGreaterThan(0);
    expect(cw?.points[1]?.y).toBeLessThan(0);
  });

  it('stays inside the swept quadrant — an arc is not its whole circle', () => {
    const [polyline] = entityToPolylines(quarter);
    for (const point of polyline?.points ?? []) {
      expect(point.x).toBeGreaterThanOrEqual(-TOLERANCE_MM);
      expect(point.y).toBeGreaterThanOrEqual(-TOLERANCE_MM);
    }
  });
});

describe('entityToPolylines — rectangle', () => {
  const rect: SketchRectangle = {
    kind: 'rect',
    id: 'r1',
    origin: { x: 5, y: 7 },
    widthMm: 20,
    heightMm: 10,
    cornerRadiusMm: 0,
  };

  it('is translated to the sketch origin, not left in local shape space', () => {
    const [polyline] = entityToPolylines(rect);
    const xs = (polyline?.points ?? []).map((point) => point.x);
    const ys = (polyline?.points ?? []).map((point) => point.y);
    expect(Math.min(...xs)).toBeCloseTo(5, 6);
    expect(Math.max(...xs)).toBeCloseTo(25, 6);
    expect(Math.min(...ys)).toBeCloseTo(7, 6);
    expect(Math.max(...ys)).toBeCloseTo(17, 6);
  });

  it('keeps a rounded rectangle inside the same extents', () => {
    const [polyline] = entityToPolylines({ ...rect, cornerRadiusMm: 3 });
    for (const point of polyline?.points ?? []) {
      expect(point.x).toBeGreaterThanOrEqual(5 - TOLERANCE_MM);
      expect(point.x).toBeLessThanOrEqual(25 + TOLERANCE_MM);
      expect(point.y).toBeGreaterThanOrEqual(7 - TOLERANCE_MM);
      expect(point.y).toBeLessThanOrEqual(17 + TOLERANCE_MM);
    }
  });
});

describe('entityToPolylines — path', () => {
  it('preserves an open path verbatim', () => {
    const path: SketchPath = {
      kind: 'path',
      id: 'p1',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ],
      closed: false,
    };
    const [polyline] = entityToPolylines(path);
    expect(polyline?.closed).toBe(false);
    expect(polyline?.points).toHaveLength(3);
  });

  it('strips a repeated closing point from a closed path', () => {
    const path: SketchPath = {
      kind: 'path',
      id: 'p2',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 0 },
      ],
      closed: true,
    };
    const [polyline] = entityToPolylines(path);
    expect(polyline?.closed).toBe(true);
    expect(polyline?.points).toHaveLength(3);
  });
});

describe('entityToPolylines — degenerate input', () => {
  it('materializes to nothing rather than to a broken polyline', () => {
    expect(
      entityToPolylines({
        kind: 'line',
        id: 'dead',
        start: { x: 1, y: 1 },
        end: { x: 1, y: 1 },
      }),
    ).toEqual([]);
  });
});

describe('entityToPolylines — determinism', () => {
  it('returns identical geometry for identical input', () => {
    const circle: SketchCircle = {
      kind: 'circle',
      id: 'c9',
      center: { x: 2, y: 2 },
      radiusMm: 7.5,
    };
    expect(entityToPolylines(circle)).toEqual(entityToPolylines(circle));
  });
});
