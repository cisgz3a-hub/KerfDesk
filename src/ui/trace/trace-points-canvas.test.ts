import { describe, expect, it, vi } from 'vitest';
import type { ColoredPath, Vec2 } from '../../core/scene';
import {
  paintTracePoints,
  tracePointsBitmapSize,
  type TracePointsWindow,
} from './trace-points-canvas';

function paths(points: ReadonlyArray<Vec2>): ColoredPath[] {
  return [{ color: '#000000', polylines: [{ points, closed: false }] }];
}

function context(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 1000;
  const result = canvas.getContext('2d');
  if (result === null) throw new Error('Missing canvas fixture');
  // The shared jsdom context supplies missing methods through a Proxy. Give
  // these observed methods real descriptors so spies can inspect the calls.
  for (const method of ['arc', 'setTransform', 'beginPath'] as const) {
    Object.defineProperty(result, method, { value: () => undefined, configurable: true });
  }
  return result;
}

const view: TracePointsWindow = {
  left: 0,
  top: 0,
  width: 1000,
  height: 1000,
  scaleX: 1,
  scaleY: 1,
};

describe('viewport point markers', () => {
  it.each([
    [1366, 768, 3],
    [50000, 50000, 2],
    [1200, 80000, 4],
  ])('bounds backing pixels at %s by %s with density %s', (width, height, ratio) => {
    const bitmap = tracePointsBitmapSize(width, height, ratio);
    expect(bitmap.width * bitmap.height).toBeLessThanOrEqual(4_194_304);
    expect(Math.max(bitmap.width, bitmap.height)).toBeLessThanOrEqual(4096);
    expect(bitmap.width / width).toBeCloseTo(bitmap.ratio, 2);
    expect(bitmap.height / height).toBeCloseTo(bitmap.ratio, 2);
  });

  it('draws the visible source coordinates after zoom and pan, including clipped edge markers', () => {
    const ctx = context();
    const arc = vi.spyOn(ctx, 'arc');
    const transform = vi.spyOn(ctx, 'setTransform');
    const points = [
      { x: 25, y: 60 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
      { x: 100.2, y: 100.2 },
      { x: 151, y: 151 },
      { x: 153, y: 151 },
    ];
    const window = { left: 100, top: 50, width: 200, height: 100, scaleX: 2, scaleY: 1 };
    expect(paintTracePoints(ctx, paths(points), window, 2, 'purple')).toBe(3);
    expect(arc.mock.calls.map(([x, y]) => ({ x, y }))).toEqual([
      { x: 50, y: 50 },
      { x: 100, y: 100 },
      { x: 151, y: 151 },
    ]);
    expect(transform).toHaveBeenLastCalledWith(4, 0, 0, 2, -200, -100);
  });

  it('combines dense screen overlaps without flattening or modifying the source geometry', () => {
    const ctx = context();
    const arc = vi.spyOn(ctx, 'arc');
    const point = Object.freeze({ x: 40, y: 40 });
    const points = Object.freeze(Array.from({ length: 200_000 }, () => point));
    const source = paths(points);
    expect(paintTracePoints(ctx, source, view, 1, 'purple')).toBe(1);
    expect(arc).toHaveBeenCalledTimes(1);
    expect(source[0]?.polylines[0]?.points).toBe(points);
    expect(points).toHaveLength(200_000);
  });

  it('bounds native drawing-path size for separated points', () => {
    const ctx = context();
    let current = 0;
    let largest = 0;
    vi.spyOn(ctx, 'beginPath').mockImplementation(() => {
      current = 0;
    });
    vi.spyOn(ctx, 'arc').mockImplementation(() => {
      current += 1;
      largest = Math.max(largest, current);
    });
    const points = Array.from({ length: 4000 }, (_, index) => ({
      x: 4 * (index % 200),
      y: 4 * Math.floor(index / 200),
    }));
    expect(paintTracePoints(ctx, paths(points), view, 1, 'purple')).toBe(4000);
    expect(largest).toBeLessThanOrEqual(1024);
  });
});
