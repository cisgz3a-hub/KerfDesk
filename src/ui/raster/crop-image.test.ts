import { describe, expect, it, vi } from 'vitest';
import type { VectorRaster } from '../../core/raster';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { createRectangle } from '../../core/shapes';
import { lumaToBase64, type BitmapFields } from './luma-bitmap';
import { cropMaskedRasterImage } from './crop-image';

function raster(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'image-1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,old',
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: lumaToBase64(new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80])),
    imageMaskId: 'mask-1',
    ...overrides,
  };
}

function maskAt(x: number, widthMm: number) {
  return createRectangle({
    id: 'mask-1',
    color: '#000000',
    spec: { widthMm, heightMm: 2, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x },
  });
}

function encode(rasterInput: VectorRaster): BitmapFields {
  return {
    dataUrl: `data:image/png;base64,${rasterInput.width}x${rasterInput.height}`,
    lumaBase64: lumaToBase64(rasterInput.luma),
  };
}

function decode(base64: string): ReadonlyArray<number> {
  return Array.from(atob(base64), (char) => char.charCodeAt(0));
}

describe('cropMaskedRasterImage', () => {
  it('bakes the image mask into source pixels and shrinks bounds to the covered pixels', async () => {
    const encoder = vi.fn(encode);

    const cropped = await cropMaskedRasterImage(raster(), maskAt(1, 2), encoder);

    expect(cropped).toMatchObject({
      id: 'image-1',
      source: 'photo.png',
      dataUrl: 'data:image/png;base64,2x2',
      pixelWidth: 2,
      pixelHeight: 2,
      bounds: { minX: 1, minY: 0, maxX: 3, maxY: 2 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'threshold',
      linesPerMm: 1,
    });
    expect(cropped.imageMaskId).toBeUndefined();
    expect(decode(cropped.lumaBase64 ?? '')).toEqual([20, 30, 60, 70]);
    expect(encoder).toHaveBeenCalledWith({
      width: 2,
      height: 2,
      luma: new Uint8Array([20, 30, 60, 70]),
    });
  });

  it('rejects a mask that does not overlap the selected image', async () => {
    await expect(cropMaskedRasterImage(raster(), maskAt(10, 2), encode)).rejects.toThrow(
      'does not overlap',
    );
  });
});
