import { describe, expect, it } from 'vitest';
import { buildFramePerimeter, nearestFrameStartPoint } from './frame-perimeter';

const bounds = { minX: 0, minY: 0, maxX: 20, maxY: 10 };

describe('selectable Frame perimeter', () => {
  it.each([0, 1, 2, 3] as const)('traces every edge once from edge %s interior', (edge) => {
    const points = buildFramePerimeter(bounds, { edge, fraction: 0.25 });
    expect(points).toHaveLength(6);
    expect(points.at(-1)).toEqual(points[0]);
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1]!;
      const point = points[i]!;
      expect(point.x === previous.x || point.y === previous.y).toBe(true);
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
    }
    expect(length).toBe(60);
    for (const point of [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ]) {
      expect(points).toContainEqual(point);
    }
  });

  it('normalizes an edge end to the next corner without an extra zero-length jog', () => {
    expect(buildFramePerimeter(bounds, { edge: 3, fraction: 1 })).toEqual(
      buildFramePerimeter(bounds),
    );
    expect(buildFramePerimeter(bounds, { edge: 1, fraction: 1 })).toHaveLength(5);
  });

  it('projects a drag onto the boundary and clamps beyond corners', () => {
    expect(nearestFrameStartPoint(bounds, { x: 7, y: -3 })).toEqual({ edge: 0, fraction: 0.35 });
    expect(nearestFrameStartPoint(bounds, { x: 23, y: 6 })).toEqual({ edge: 1, fraction: 0.6 });
    const nearest = nearestFrameStartPoint(bounds, { x: -5, y: 15 });
    expect(buildFramePerimeter(bounds, nearest)[0]).toEqual({ x: 0, y: 10 });
  });

  it('keeps line and point jobs finite when their frame has a collapsed edge', () => {
    const line = { ...bounds, maxX: 0 };
    expect(nearestFrameStartPoint(line, { x: 3, y: 6 })).toEqual({ edge: 1, fraction: 0.6 });
    const point = { ...line, maxY: 0 };
    expect(nearestFrameStartPoint(point, { x: 3, y: 6 })).toEqual({ edge: 0, fraction: 0 });
  });
});
