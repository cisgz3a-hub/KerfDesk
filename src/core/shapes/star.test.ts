import { describe, expect, it } from 'vitest';
import { starToPolylines } from './star';

describe('starToPolylines', () => {
  it('creates a closed five-point star with alternating outer and inner vertices', () => {
    const [polyline] = starToPolylines({
      points: 5,
      outerRadiusMm: 10,
      innerRadiusRatio: 0.5,
    });

    expect(polyline?.closed).toBe(true);
    expect(polyline?.points).toHaveLength(11);

    const points = polyline?.points ?? [];
    expect(points[0]?.x).toBeCloseTo(10, 5);
    expect(points[0]?.y).toBeCloseTo(0, 5);
    expect(points.at(-1)).toEqual(points[0]);

    const center = { x: 10, y: 10 };
    const radii = points.slice(0, -1).map((point) => Math.hypot(point.x - center.x, point.y - center.y));
    expect(radii[0]).toBeCloseTo(10, 5);
    expect(radii[1]).toBeCloseTo(5, 5);
    expect(radii[2]).toBeCloseTo(10, 5);
    expect(radii[3]).toBeCloseTo(5, 5);
  });
});
