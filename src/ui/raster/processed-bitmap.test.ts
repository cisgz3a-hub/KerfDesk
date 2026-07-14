import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type RasterImage } from '../../core/scene';
import {
  buildProcessedRasterBitmap,
  processedRasterDimensions,
  processedRasterPreviewDimensions,
} from './processed-bitmap';

describe('processed raster bitmap', () => {
  it('matches image-layer grayscale preview power and min-power scaling', () => {
    const layer = imageLayer({
      ditherAlgorithm: 'grayscale',
      minPower: 10,
      power: 30,
      passThrough: true,
    });
    const result = buildProcessedRasterBitmap(
      rasterImage({ pixelWidth: 3, pixelHeight: 1, luma: [0, 128, 255] }),
      layer,
      DEFAULT_DEVICE_PROFILE,
    );

    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' ? Array.from(result.rgba) : []).toEqual([
      0, 0, 0, 255, 85, 85, 85, 255, 255, 255, 255, 255,
    ]);
  });

  it('applies negative image before threshold processing', () => {
    const layer = imageLayer({
      ditherAlgorithm: 'threshold',
      negativeImage: true,
      passThrough: true,
    });
    const result = buildProcessedRasterBitmap(
      rasterImage({ pixelWidth: 2, pixelHeight: 1, luma: [0, 255] }),
      layer,
      DEFAULT_DEVICE_PROFILE,
    );

    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' ? Array.from(result.rgba) : []).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255,
    ]);
  });

  it('uses the emitted raster grid when pass-through is off', () => {
    const layer = imageLayer({ linesPerMm: 2, passThrough: false });
    const image = rasterImage({
      pixelWidth: 2,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 1 },
      luma: [0, 255],
    });

    expect(processedRasterDimensions(image, layer)).toEqual({ width: 10, height: 2 });
  });

  it('rejects over-budget processed bitmaps before allocating the output buffer', () => {
    const layer = imageLayer({ linesPerMm: 10, passThrough: false });
    const result = buildProcessedRasterBitmap(
      rasterImage({
        pixelWidth: 2,
        pixelHeight: 2,
        bounds: { minX: 0, minY: 0, maxX: 400.1, maxY: 400.1 },
        luma: [0, 0, 0, 0],
      }),
      layer,
      DEFAULT_DEVICE_PROFILE,
    );

    expect(result).toMatchObject({ kind: 'too-large', width: 4001, height: 4001 });
  });

  it('caps only preview dimensions while leaving burn dimensions unchanged', () => {
    const image = rasterImage({
      pixelWidth: 6000,
      pixelHeight: 3000,
      bounds: { minX: 0, minY: 0, maxX: 600, maxY: 300 },
    });
    const layer = imageLayer({ passThrough: true });

    expect(processedRasterDimensions(image, layer)).toEqual({ width: 6000, height: 3000 });
    expect(processedRasterPreviewDimensions(image, layer)).toEqual({
      width: 2048,
      height: 1024,
    });
  });

  it('builds a bounded preview without changing the full burn bitmap result', () => {
    const image = rasterImage({
      pixelWidth: 4,
      pixelHeight: 2,
      luma: [0, 0, 255, 255, 0, 0, 255, 255],
    });
    const layer = imageLayer({ passThrough: true, ditherAlgorithm: 'threshold' });

    const burn = buildProcessedRasterBitmap(image, layer, DEFAULT_DEVICE_PROFILE);
    const preview = buildProcessedRasterBitmap(image, layer, DEFAULT_DEVICE_PROFILE, {
      maxEdge: 2,
    });

    expect(burn).toMatchObject({ kind: 'ok', width: 4, height: 2 });
    expect(preview).toMatchObject({ kind: 'ok', width: 2, height: 1 });
  });

  it('applies an image mask before dithering the processed bitmap', () => {
    const layer = imageLayer({ ditherAlgorithm: 'threshold', passThrough: true });
    const mask = {
      kind: 'shape' as const,
      id: 'M1',
      color: '#000000',
      spec: { kind: 'rect' as const, widthMm: 2, heightMm: 1, cornerRadiusMm: 0 },
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      transform: { ...IDENTITY_TRANSFORM, x: 1, y: 0 },
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 1 },
                { x: 0, y: 1 },
              ],
            },
          ],
        },
      ],
    };

    const result = buildProcessedRasterBitmap(
      rasterImage({ pixelWidth: 4, pixelHeight: 1, luma: [0, 0, 0, 0], imageMaskId: 'M1' }),
      layer,
      DEFAULT_DEVICE_PROFILE,
      { maskObject: mask },
    );

    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' ? Array.from(result.rgba) : []).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ]);
  });
});

function imageLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
    ...overrides,
  };
}

function rasterImage(
  overrides: Partial<RasterImage> & { readonly luma?: ReadonlyArray<number> } = {},
): RasterImage {
  const pixelWidth = overrides.pixelWidth ?? 2;
  const pixelHeight = overrides.pixelHeight ?? 2;
  const luma = overrides.luma ?? [255, 255, 255, 255];
  const { luma: _luma, ...imageOverrides } = overrides;
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth,
    pixelHeight,
    bounds: overrides.bounds ?? { minX: 0, minY: 0, maxX: pixelWidth, maxY: pixelHeight },
    transform: overrides.transform ?? IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    lumaBase64: Buffer.from(luma).toString('base64'),
    ...imageOverrides,
  };
}
