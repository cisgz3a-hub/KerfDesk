import { describe, expect, it } from 'vitest';
import type { PathSegment, Vec2 } from '../scene';
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

  it('fairs a faceted drawn arc with the shared tracer spline', () => {
    const points = Array.from({ length: 13 }, (_, index) => {
      const angle = (index / 12) * Math.PI;
      return { x: 50 + 50 * Math.cos(angle), y: 50 * Math.sin(angle) };
    });

    const shape = createPolyline({
      id: 'PL4',
      color: '#000000',
      spec: { points, closed: false },
    });
    const curve = shape.paths[0]?.curves?.[0];

    expect(shape.spec).toEqual({ kind: 'polyline', points, closed: false });
    expect(curve?.closed).toBe(false);
    expect(curve?.segments.every((segment) => segment.kind === 'cubic')).toBe(true);
    expect(curve?.segments).toHaveLength(points.length - 1);
    expect(shape.paths[0]?.polylines[0]?.points.length).toBeGreaterThan(points.length);
  });

  it('rounds sparse alternating pen bends instead of emitting straight cubic edges', () => {
    const points = [
      { x: 0, y: 80 },
      { x: 30, y: 20 },
      { x: 60, y: 80 },
      { x: 90, y: 20 },
      { x: 120, y: 80 },
    ];
    const shape = createPolyline({
      id: 'PL-soft',
      color: '#000000',
      spec: { points, closed: false },
    });
    const curve = shape.paths[0]?.curves?.[0];

    expect(
      curve === undefined ? 0 : countVisiblyCurved(curve.start, curve.segments),
    ).toBeGreaterThanOrEqual(3);
  });

  it('fairs a dense closed loop but preserves a deliberate triangle', () => {
    const loop = Array.from({ length: 12 }, (_, index) => {
      const angle = (index / 12) * Math.PI * 2;
      return { x: 30 * Math.cos(angle), y: 30 * Math.sin(angle) };
    });
    const rounded = createPolyline({
      id: 'PL5',
      color: '#000000',
      spec: { points: loop, closed: true },
    });
    const triangle = createPolyline({
      id: 'PL6',
      color: '#000000',
      spec: {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 15 },
        ],
        closed: true,
      },
    });

    expect(rounded.paths[0]?.curves?.[0]?.closed).toBe(true);
    expect(
      rounded.paths[0]?.curves?.[0]?.segments.every((segment) => segment.kind === 'cubic'),
    ).toBe(true);
    expect(
      triangle.paths[0]?.curves?.[0]?.segments.every((segment) => segment.kind === 'line'),
    ).toBe(true);
  });
});

function countVisiblyCurved(start: Vec2, segments: ReadonlyArray<PathSegment>): number {
  let count = 0;
  let from = start;
  for (const segment of segments) {
    if (segment.kind === 'cubic' && distanceFromChord(segment.control1, from, segment.to) > 0.5) {
      count += 1;
    }
    from = segment.to;
  }
  return count;
}

function distanceFromChord(control: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const cross = (control.x - start.x) * dy - (control.y - start.y) * dx;
  return Math.abs(cross) / Math.hypot(dx, dy);
}
