import { describe, expect, it } from 'vitest';
import { polylineToPolylines } from './polyline';

describe('polylineToPolylines', () => {
  it('wraps an open point run in one polyline with closed:false', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const out = polylineToPolylines({ points, closed: false });
    expect(out).toHaveLength(1);
    expect(out[0]?.closed).toBe(false);
    expect(out[0]?.points).toEqual(points);
  });

  it('closes a closed polyline by repeating the first vertex (stroke renderer never closePaths)', () => {
    const out = polylineToPolylines({
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 5 },
      ],
      closed: true,
    });
    expect(out[0]?.closed).toBe(true);
    // 3 vertices + the repeated first vertex = 4 points, last === first.
    expect(out[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
      { x: 0, y: 0 },
    ]);
  });

  it('materializes an empty point list to no polyline', () => {
    expect(polylineToPolylines({ points: [], closed: false })).toEqual([]);
  });
});
