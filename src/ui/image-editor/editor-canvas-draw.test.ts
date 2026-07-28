import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_AFFINE } from '../../core/image-edit';
import { drawTransformPreview } from './editor-canvas-draw';

const MAX_BYTE = 255;
const PARTIAL_ALPHA = 64;
const HALF_MASK_ALPHA = 128;
const EXPECTED_EFFECTIVE_ALPHA = 32;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('drawTransformPreview', () => {
  it('sends intrinsic-alpha-weighted pixels to the preview canvas', () => {
    const putImageData = vi.fn();
    const floatCanvas = document.createElement('canvas');
    Object.defineProperty(floatCanvas, 'getContext', {
      value: () => ({ putImageData }),
    });
    vi.spyOn(document, 'createElement').mockReturnValue(floatCanvas);
    vi.stubGlobal(
      'ImageData',
      class {
        readonly data: Uint8ClampedArray;
        readonly width: number;
        readonly height: number;

        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );
    // The draw function uses only this Canvas2D subset; the assertion bridges
    // the deliberately minimal test double to the browser interface.
    const context = {
      save: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;
    const pixels = new Uint8ClampedArray([0, MAX_BYTE, 0, 0, 10, 20, 240, PARTIAL_ALPHA]);
    const maskAlpha = new Uint8Array([MAX_BYTE, HALF_MASK_ALPHA]);

    drawTransformPreview(
      context,
      { scale: 1, panX: 0, panY: 0 },
      {
        rect: { x: 0, y: 0, width: 2, height: 1 },
        pixels,
        alpha: maskAlpha,
        affine: IDENTITY_AFFINE,
      },
    );

    expect(putImageData).toHaveBeenCalledTimes(1);
    const image: unknown = putImageData.mock.calls[0]?.[0];
    if (
      typeof image !== 'object' ||
      image === null ||
      !('data' in image) ||
      !(image.data instanceof Uint8ClampedArray)
    ) {
      throw new Error('preview did not publish ImageData');
    }
    expect(Array.from(image.data)).toEqual([
      0,
      MAX_BYTE,
      0,
      0,
      10,
      20,
      240,
      EXPECTED_EFFECTIVE_ALPHA,
    ]);
    expect(context.drawImage).toHaveBeenCalledTimes(1);
  });
});
