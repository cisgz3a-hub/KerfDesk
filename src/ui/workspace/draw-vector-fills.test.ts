import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Polyline } from '../../core/scene';
import { fillClosedPolylinesBatched } from './draw-vector-strokes';

const object: ImportedSvg = {
  kind: 'imported-svg',
  id: 'fill-artwork',
  source: 'fill.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [],
};
const view = { scale: 2, offsetX: 5, offsetY: 7 };

function context() {
  const calls = {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
  };
  return { calls, ctx: calls as unknown as CanvasRenderingContext2D };
}

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

describe('filled vector construction', () => {
  it('avoids repeated native closure work while retaining every dense contour vertex', () => {
    const { ctx, calls } = context();
    const polylines = Array.from({ length: 2048 }, (_, i) => square(i % 64, Math.floor(i / 64), 1));
    fillClosedPolylinesBatched(ctx, object, polylines, view);
    expect(calls.beginPath).toHaveBeenCalledTimes(1);
    expect(calls.moveTo).toHaveBeenCalledTimes(2048);
    expect(calls.lineTo).toHaveBeenCalledTimes(6144);
    expect(calls.fill).toHaveBeenCalledExactlyOnceWith('evenodd');
    // Retain the native construction improvement without a timing assertion.
    expect(calls.closePath.mock.calls.length).toBe(0);
  });

  it.each(['evenodd', 'nonzero'] as const)(
    'keeps nested contour order, the %s rule, and excludes open artwork',
    (rule) => {
      const { ctx, calls } = context();
      fillClosedPolylinesBatched(
        ctx,
        object,
        [square(0, 0, 10), { ...square(3, 3, 4), closed: false }, square(2, 2, 6)],
        view,
        rule,
      );
      expect(calls.moveTo.mock.calls).toEqual([
        [5, 7],
        [9, 11],
      ]);
      expect(calls.lineTo.mock.calls).toEqual([
        [25, 7],
        [25, 27],
        [5, 27],
        [21, 11],
        [21, 23],
        [9, 23],
      ]);
      expect(calls.fill).toHaveBeenCalledExactlyOnceWith(rule);
    },
  );
});
