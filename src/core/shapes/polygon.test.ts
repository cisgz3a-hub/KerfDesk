import { describe, expect, it } from 'vitest';
import { polygonToPolylines } from './polygon';
import { createPolygon } from './create-polygon';

describe('polygonToPolylines', () => {
  it('produces `sides` vertices on a circle of `radiusMm` with the first vertex up', () => {
    const [polyline] = polygonToPolylines({ sides: 6, radiusMm: 10 });
    const points = polyline?.points ?? [];
    expect(polyline?.closed).toBe(true);
    // 6 vertices + the repeated first vertex that closes the loop (the stroke
    // renderer never calls closePath).
    expect(points).toHaveLength(7);
    expect(points[points.length - 1]).toEqual(points[0]);
    // Centered at (10, 10); every vertex is the circumradius from the center.
    for (const p of points) {
      expect(Math.hypot(p.x - 10, p.y - 10)).toBeCloseTo(10, 5);
    }
    // First vertex points up: (cx, cy - r) = (10, 0).
    expect(points[0]?.x).toBeCloseTo(10);
    expect(points[0]?.y).toBeCloseTo(0);
  });

  it('clamps sides into [3, 64] (point count is sides + 1 for the closing vertex)', () => {
    expect(polygonToPolylines({ sides: 2, radiusMm: 5 })[0]?.points).toHaveLength(4);
    expect(polygonToPolylines({ sides: 1000, radiusMm: 5 })[0]?.points).toHaveLength(65);
  });
});

describe('createPolygon', () => {
  it('materializes a kind:shape polygon with vertex-derived bounds', () => {
    const shape = createPolygon({ id: 'P1', color: '#0000ff', spec: { sides: 4, radiusMm: 10 } });
    expect(shape.kind).toBe('shape');
    expect(shape.spec).toEqual({ kind: 'polygon', sides: 4, radiusMm: 10 });
    // A 4-gon (radius 10, first vertex up) has vertices (10,0)(20,10)(10,20)(0,10).
    expect(shape.bounds).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
    expect(shape.paths[0]?.color).toBe('#0000ff');
  });
});
