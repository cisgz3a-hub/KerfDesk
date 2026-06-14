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

  it('honors the closed flag', () => {
    const out = polylineToPolylines({
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 5 },
      ],
      closed: true,
    });
    expect(out[0]?.closed).toBe(true);
  });

  it('materializes an empty point list to no polyline', () => {
    expect(polylineToPolylines({ points: [], closed: false })).toEqual([]);
  });
});
