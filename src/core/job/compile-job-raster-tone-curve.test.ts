import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  fitPhotoToneCurve,
  IDENTITY_PHOTO_TONE_CURVE,
  photoToneCurveLut,
  type PhotoToneCurve,
} from '../raster/photo-tone-curve';
import { encodeCanonicalBase64 } from '../relief/depth-map-base64';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  layerOperationSettingsEqual,
  type DitherAlgorithm,
  type Layer,
  type RasterImage,
} from '../scene';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import { decodeRasterLuma } from './raster-luma-decode';

const WIDTH = 64;
const HEIGHT = 16;
const CURVE: PhotoToneCurve = fitPhotoToneCurve(
  [10, 20, 30, 40, 50, 60, 70, 80, 90].map((commandedPercent) => ({
    commandedPercent,
    observedPercent: 100 * (1 - (1 - commandedPercent / 100) ** 2),
  })),
  'Birch',
);

function gradient(overrides: Partial<RasterImage> = {}): RasterImage {
  const luma = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1)
    for (let x = 0; x < WIDTH; x += 1) luma[y * WIDTH + x] = Math.round((x / (WIDTH - 1)) * 255);
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: encodeCanonicalBase64(luma),
    pixelWidth: WIDTH,
    pixelHeight: HEIGHT,
    bounds: { minX: 0, minY: 0, maxX: 32, maxY: 8 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    operationIds: ['photo-op'],
    dither: 'jarvis',
    linesPerMm: 5,
    ...overrides,
  };
}

function operation(ditherAlgorithm: DitherAlgorithm, extra: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'photo-op', color: '#808080', mode: 'image' }),
    ditherAlgorithm,
    linesPerMm: 5,
    power: 50,
    ...extra,
  };
}

function compiledValues(image: RasterImage, layer: Layer): Float64Array {
  const group = compileRasterGroupsForLayer([image], layer, DEFAULT_DEVICE_PROFILE).groups[0];
  if (group === undefined) throw new Error('No raster group');
  return Float64Array.from(group.sValues);
}

function total(values: Float64Array): number {
  return values.reduce((sum, value) => sum + value, 0);
}

describe('ADR-670 tone curve in compiled raster output', () => {
  it.each(['jarvis', 'grayscale'] as const)(
    'compiles %s byte-identically with no curve, an absent key or the identity curve',
    (dither) => {
      const plain = compiledValues(gradient(), operation(dither));
      expect(compiledValues(gradient(), operation(dither, { photoToneCurve: undefined }))).toEqual(
        plain,
      );
      expect(
        compiledValues(
          gradient(),
          operation(dither, { photoToneCurve: IDENTITY_PHOTO_TONE_CURVE }),
        ),
      ).toEqual(plain);
    },
  );

  it.each(['jarvis', 'stucki', 'floyd-steinberg', 'grayscale'] as const)(
    'burns lighter %s output when the material darkens',
    (dither) => {
      const plain = total(compiledValues(gradient(), operation(dither)));
      const calibrated = total(
        compiledValues(gradient(), operation(dither, { photoToneCurve: CURVE })),
      );
      expect(calibrated).toBeLessThan(plain * 0.9);
    },
  );

  it("applies a curve chosen for one photo through that photo's operation override", () => {
    const image = gradient({
      operationOverride: { byOperation: { 'photo-op': { photoToneCurve: CURVE } } },
    });
    expect(compiledValues(image, operation('jarvis'))).toEqual(
      compiledValues(gradient(), operation('jarvis', { photoToneCurve: CURVE })),
    );
  });

  it('burns the same dots as a source pre-mapped through the curve', () => {
    const lut = photoToneCurveLut(CURVE);
    const source = decodeRasterLuma(gradient());
    const baked = gradient({
      lumaBase64: encodeCanonicalBase64(source.map((value) => lut[value] ?? 255)),
    });
    expect(compiledValues(gradient(), operation('jarvis', { photoToneCurve: CURVE }))).toEqual(
      compiledValues(baked, operation('jarvis')),
    );
  });

  it('treats operations holding equal curves as the same settings', () => {
    const left = operation('jarvis', { photoToneCurve: CURVE });
    const right = operation('jarvis', { photoToneCurve: structuredClone(CURVE) });
    expect(layerOperationSettingsEqual(left, right)).toBe(true);
    expect(layerOperationSettingsEqual(left, operation('jarvis'))).toBe(false);
  });
});
