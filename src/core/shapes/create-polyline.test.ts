import { describe, expect, it } from 'vitest';
import { createPolyline } from './create-polyline';

describe('createPolyline', () => {
  it('materializes a kind:shape polyline with vertex-extent bounds', () => {
    const points = [
      { x: 2, y: 3 },
      { x: 12, y: 3 },
      { x: 12, y: 9 },
    ];
    const shape = createPolyline({ id: 'PL1', color: '#ff0000', spec: { points, closed: false } });
    expect(shape.kind).toBe('shape');
    expect(shape.spec).toEqual({ kind: 'polyline', points, closed: false });
    expect(shape.color).toBe('#ff0000');
    expect(shape.bounds).toEqual({ minX: 2, minY: 3, maxX: 12, maxY: 9 });
    expect(shape.paths[0]?.color).toBe('#ff0000');
    expect(shape.paths[0]?.polylines[0]?.closed).toBe(false);
    expect(shape.paths[0]?.curves?.[0]?.segments).toHaveLength(2);
  });

  it('carries the closed flag into the materialized path', () => {
    const shape = createPolyline({
      id: 'PL2',
      color: '#000000',
      spec: {
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 2, y: 4 },
        ],
        closed: true,
      },
    });
    expect(shape.paths[0]?.polylines[0]?.closed).toBe(true);
  });

  it('gives an empty-points polyline zero bounds and no polyline', () => {
    const shape = createPolyline({
      id: 'PL3',
      color: '#000000',
      spec: { points: [], closed: false },
    });
    expect(shape.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(shape.paths[0]?.polylines).toEqual([]);
    expect(shape.paths[0]?.curves).toEqual([]);
  });
});
