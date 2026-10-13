import { expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { drawPathNodeHandles } from './draw-path-node-handles';

it('culls fully offscreen handles but retains handles crossing the viewport edge', () => {
  const fillRect = vi.fn();
  const ctx = {
    canvas: { width: 100, height: 100 },
    fillRect,
    strokeRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  drawPathNodeHandles(ctx, artwork([-100, -3, 50, 103, 110]), { scale: 1, offsetX: 0, offsetY: 0 });
  expect(fillRect.mock.calls).toEqual([
    [-6, 47, 6, 6],
    [47, 47, 6, 6],
    [100, 47, 6, 6],
  ]);
});

function artwork(xs: ReadonlyArray<number>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'trace',
    source: 'trace.svg',
    bounds: { minX: -100, minY: 50, maxX: 110, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      { color: '#000000', polylines: [{ closed: false, points: xs.map((x) => ({ x, y: 50 })) }] },
    ],
  };
}
