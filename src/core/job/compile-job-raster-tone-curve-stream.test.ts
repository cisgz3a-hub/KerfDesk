import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { fitPhotoToneCurve, photoToneCurveLut } from '../raster/photo-tone-curve';
import { encodeCanonicalBase64 } from '../relief/depth-map-base64';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type RasterImage } from '../scene';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import type * as RasterBudget from '../raster/raster-budget';

// Stream every raster, however small, so the row provider path is the one tested.
vi.mock('../raster/raster-budget', async (importOriginal) => ({
  ...(await importOriginal<typeof RasterBudget>()),
  STREAMED_RASTER_PIXEL_THRESHOLD: 0,
}));

const WIDTH = 48;
const HEIGHT = 12;
const CURVE = fitPhotoToneCurve([{ commandedPercent: 40, observedPercent: 70 }], 'Cherry');

function image(luma: Uint8Array): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: encodeCanonicalBase64(luma),
    pixelWidth: WIDTH,
    pixelHeight: HEIGHT,
    bounds: { minX: 0, minY: 0, maxX: 24, maxY: 6 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    operationIds: ['photo-op'],
    dither: 'stucki',
    linesPerMm: 4,
  };
}

function rows(object: RasterImage, layer: Layer): number[][] {
  const group = compileRasterGroupsForLayer([object], layer, DEFAULT_DEVICE_PROFILE).groups[0];
  if (group?.rowProvider === undefined) throw new Error('Expected a streamed raster group');
  return Array.from({ length: group.pixelHeight }, (_, y) =>
    Array.from(group.rowProvider?.(y) ?? []),
  );
}

describe('ADR-670 tone curve on the streamed raster path', () => {
  it.each(['stucki', 'grayscale'] as const)(
    'streams %s rows corrected exactly like a source pre-mapped through the curve',
    (ditherAlgorithm) => {
      const source = Uint8Array.from({ length: WIDTH * HEIGHT }, (_, index) => (index * 37) % 256);
      const lut = photoToneCurveLut(CURVE);
      const layer: Layer = {
        ...createLayer({ id: 'photo-op', color: '#808080', mode: 'image' }),
        ditherAlgorithm,
        linesPerMm: 4,
      };
      const calibrated = rows(image(source), { ...layer, photoToneCurve: CURVE });
      expect(calibrated).toEqual(rows(image(source.map((value) => lut[value] ?? 255)), layer));
      expect(calibrated).not.toEqual(rows(image(source), layer));
    },
  );
});
