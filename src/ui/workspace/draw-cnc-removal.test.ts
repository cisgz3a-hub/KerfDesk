import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemovalGrid } from '../../core/sim';
import { drawCncRemoval } from './draw-cnc-removal';

afterEach(() => vi.restoreAllMocks());

describe('drawCncRemoval', () => {
  it('draws the last grid pixel only across its exact partial-cell footprint', () => {
    const bitmap = offscreenBitmap();
    vi.spyOn(document, 'createElement').mockReturnValue(bitmap);
    const result = createRemovalGrid({
      originX: 10,
      originY: 20,
      widthMm: 1,
      heightMm: 0.5,
      mmPerCell: 0.3,
    });
    if (result.kind === 'error') throw new Error(result.reason);
    result.grid.depth.fill(-1);
    const ctx = drawContext();

    drawCncRemoval(ctx, result.grid, { scale: 2, offsetX: 1, offsetY: 2 }, undefined);

    expect(ctx.drawImage).toHaveBeenCalledTimes(4);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(
      4,
      bitmap,
      3,
      1,
      1,
      1,
      expect.closeTo(10.9, 10),
      expect.closeTo(20.3, 10),
      expect.closeTo(0.1, 10),
      expect.closeTo(0.2, 10),
    );
  });
});

function offscreenBitmap(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: vi.fn(),
    }),
  } as unknown as HTMLCanvasElement;
}

function drawContext(): CanvasRenderingContext2D & {
  readonly drawImage: ReturnType<typeof vi.fn>;
} {
  return {
    imageSmoothingEnabled: true,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D & { readonly drawImage: ReturnType<typeof vi.fn> };
}
