import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { drawPartialGridBitmapAtTransform } from './draw-raster';

describe('drawPartialGridBitmapAtTransform', () => {
  it('blits the terminal row and column at their proportional physical sizes', () => {
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const bitmap = {} as CanvasImageSource;

    drawPartialGridBitmapAtTransform(
      ctx,
      bitmap,
      { widthCells: 4, heightCells: 2, widthMm: 1, heightMm: 0.5, mmPerCell: 0.3 },
      { minX: 2, minY: 4, maxX: 12, maxY: 9 },
      { ...IDENTITY_TRANSFORM, x: 3, y: 5 },
      { scale: 2, offsetX: 7, offsetY: 11 },
    );

    expect(ctx.translate).toHaveBeenCalledWith(13, 21);
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
    expect(ctx.drawImage).toHaveBeenCalledTimes(4);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(
      1,
      bitmap,
      0,
      0,
      3,
      1,
      2,
      4,
      expect.closeTo(9, 10),
      expect.closeTo(3, 10),
    );
    expect(ctx.drawImage).toHaveBeenNthCalledWith(
      2,
      bitmap,
      3,
      0,
      1,
      1,
      expect.closeTo(11, 10),
      4,
      expect.closeTo(1, 10),
      expect.closeTo(3, 10),
    );
    expect(ctx.drawImage).toHaveBeenNthCalledWith(
      3,
      bitmap,
      0,
      1,
      3,
      1,
      2,
      expect.closeTo(7, 10),
      expect.closeTo(9, 10),
      expect.closeTo(2, 10),
    );
    expect(ctx.drawImage).toHaveBeenNthCalledWith(
      4,
      bitmap,
      3,
      1,
      1,
      1,
      expect.closeTo(11, 10),
      expect.closeTo(7, 10),
      expect.closeTo(1, 10),
      expect.closeTo(2, 10),
    );
  });
});
