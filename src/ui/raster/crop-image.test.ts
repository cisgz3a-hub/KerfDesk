import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VectorRaster } from '../../core/raster';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { lumaToBase64, type BitmapFields } from './luma-bitmap';
import { cropMaskedRasterImage } from './crop-image';
import * as imageLoader from '../trace/image-loader';

afterEach(() => {
  vi.restoreAllMocks();
});

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
  it('crops a 2 megapixel image without losing row registration or source pixels', async () => {
    const width = 2048;
    const height = 1024;
    const luma = Uint8Array.from({ length: width * height }, (_, index) => index % 251);
    const input = raster({
      pixelWidth: width,
      pixelHeight: height,
      bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
      lumaBase64: lumaToBase64(luma),
    });
    const mask = createRectangle({
      id: 'mask-1',
      color: input.color,
      spec: { widthMm: 1024, heightMm: height, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 512 },
    });
    const encoder = vi.fn(encode);
    const cropped = await cropMaskedRasterImage(input, mask, encoder);
    expect([cropped.pixelWidth, cropped.pixelHeight]).toEqual([1024, 1024]);
    expect(cropped.bounds).toEqual({ minX: 512, minY: 0, maxX: 1536, maxY: 1024 });
    const output = encoder.mock.calls[0]?.[0].luma;
    expect(output).toBeDefined();
    for (let y = 0; y < height; y += 1) {
      expect(output?.subarray(y * 1024, (y + 1) * 1024)).toEqual(
        luma.subarray(y * width + 512, y * width + 1536),
      );
    }
    expect(input.imageMaskId).toBe('mask-1');
    expect(input.lumaBase64).toBe(lumaToBase64(luma));
  });

  it.each([undefined, 'bad base64', 'AA=='])(
    'recovers embedded pixels when luma is missing or corrupt (%s)',
    async (lumaBase64) => {
      const { lumaBase64: _storedLuma, ...embedded } = raster();
      const input = lumaBase64 === undefined ? embedded : { ...embedded, lumaBase64 };
      const rgba = new Uint8ClampedArray(4 * 2 * 4);
      for (let i = 0; i < 8; i += 1)
        rgba.set([(i + 1) * 10, (i + 1) * 10, (i + 1) * 10, 255], i * 4);
      const loader = vi
        .spyOn(imageLoader, 'loadImageAsRawData')
        .mockResolvedValue({ width: 4, height: 2, data: rgba });
      const cropped = await cropMaskedRasterImage(input, maskAt(1, 2), encode);
      expect(decode(cropped.lumaBase64 ?? '')).toEqual([20, 30, 60, 70]);
      expect(loader).toHaveBeenCalledOnce();
    },
  );

  it('rejects missing source pixels instead of publishing a white crop', async () => {
    const { lumaBase64: _luma, dataUrl: _url, ...input } = raster();
    const encoder = vi.fn(encode);
    await expect(cropMaskedRasterImage(input, maskAt(1, 2), encoder)).rejects.toThrow(
      'neither embedded pixels nor a page-backed source',
    );
    expect(encoder).not.toHaveBeenCalled();
  });

  it('crops a legacy turned-JPEG raster on the grid it was saved with', async () => {
    // Imported before EXIF Orientation was honoured (ADR-404): saved 4x2 with
    // the photo squashed into it, while the loader now decodes it turned, 2x4.
    const { lumaBase64: _luma, ...input } = raster();
    const rgba = new Uint8ClampedArray(4 * 2 * 4);
    for (let i = 0; i < 8; i += 1) rgba.set([100, 100, 100, 255], i * 4);
    vi.spyOn(imageLoader, 'loadImageAsRawData').mockResolvedValue({
      width: 2,
      height: 4,
      data: rgba,
    });

    const cropped = await cropMaskedRasterImage(input, maskAt(1, 2), encode);

    expect(cropped).toMatchObject({ pixelWidth: 2, pixelHeight: 2 });
    expect(decode(cropped.lumaBase64 ?? '')).toEqual([100, 100, 100, 100]);
  });

  it('rejects an embedded source with inconsistent dimensions instead of misregistering the crop', async () => {
    const { lumaBase64: _luma, ...input } = raster();
    vi.spyOn(imageLoader, 'loadImageAsRawData').mockResolvedValue({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray(8),
    });
    await expect(cropMaskedRasterImage(input, maskAt(1, 2), encode)).rejects.toThrow(
      'dimensions do not match',
    );
  });

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
