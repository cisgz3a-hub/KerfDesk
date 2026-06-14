import { describe, expect, it } from 'vitest';
import { ellipseToPolylines } from './ellipse';
import { createEllipse } from './create-ellipse';

describe('ellipseToPolylines', () => {
  it('produces a closed polyline whose points lie on the ellipse inscribed in [0,w]x[0,h]', () => {
    const [polyline, ...rest] = ellipseToPolylines({ widthMm: 80, heightMm: 40 });
    expect(rest).toHaveLength(0);
    expect(polyline?.closed).toBe(true);
    const points = polyline?.points ?? [];
    expect(points.length).toBeGreaterThanOrEqual(24);
    const a = 40;
    const b = 20; // radii; ellipse centered at (a, b)
    for (const p of points) {
      expect(((p.x - a) / a) ** 2 + ((p.y - b) / b) ** 2).toBeCloseTo(1, 5);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(80);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(40);
    }
  });

  it('scales segment count with radius (a bigger ellipse gets more points)', () => {
    const small = ellipseToPolylines({ widthMm: 10, heightMm: 10 })[0]?.points.length ?? 0;
    const big = ellipseToPolylines({ widthMm: 400, heightMm: 400 })[0]?.points.length ?? 0;
    expect(big).toBeGreaterThan(small);
  });
});

describe('createEllipse', () => {
  it('materializes a kind:shape ellipse with the inscribing-box bounds', () => {
    const shape = createEllipse({
      id: 'E1',
      color: '#00ff00',
      spec: { widthMm: 80, heightMm: 40 },
    });
    expect(shape.kind).toBe('shape');
    expect(shape.spec).toEqual({ kind: 'ellipse', widthMm: 80, heightMm: 40 });
    expect(shape.bounds).toEqual({ minX: 0, minY: 0, maxX: 80, maxY: 40 });
    expect(shape.paths[0]?.color).toBe('#00ff00');
    expect(shape.paths[0]?.polylines[0]?.closed).toBe(true);
  });
});
