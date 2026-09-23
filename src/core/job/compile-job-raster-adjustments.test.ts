import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, DITHER_ALGORITHMS, IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { grblStrategy } from '../output/grbl-strategy';
import { compileJob } from './compile-job';
import type { Job, RasterGroup } from './job';

const dev = DEFAULT_DEVICE_PROFILE;

function firstRasterGroup(job: Job): RasterGroup | undefined {
  const group = job.groups[0];
  return group?.kind === 'raster' ? group : undefined;
}

function rasterObject(lumaBase64: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 1,
    lumaBase64,
  };
}

function twoPixelRasterObject(lumaBase64: string): RasterImage {
  return {
    ...rasterObject(lumaBase64),
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
  };
}

describe('compileJob raster image adjustments', () => {
  it.each(DITHER_ALGORITHMS)(
    'keeps original pixels and emitted output in pass-through (%s)',
    (algorithm) => {
      const layer = {
        ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
        ditherAlgorithm: algorithm,
        negativeImage: true,
        passThrough: true,
        power: 100,
        linesPerMm: 25,
      };
      const image = {
        ...twoPixelRasterObject('AP8='),
        brightness: 100,
        contrast: -100,
        gamma: 5,
      };
      const job = compileJob({ objects: [image], layers: [layer] }, dev);
      expect(firstRasterGroup(job)).toMatchObject({ pixelWidth: 2, pixelHeight: 1 });
      expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([1000, 0]);
      const output = grblStrategy.emit(job, dev, {
        compactMotionWords: false,
        finishPosition: null,
      });
      expect(output.split('\n').filter((line) => /^G1\b.*\bS1000\b/.test(line))).toHaveLength(1);
      expect(output).toContain('G1 X1.000');
    },
  );

  it('preserves grey values without re-dithering, and resumes adjustments when pass-through is off', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      ditherAlgorithm: 'threshold' as const,
      passThrough: true,
      power: 100,
      linesPerMm: 1,
    };
    const image = { ...rasterObject('gA=='), brightness: 100 };
    expect(
      Array.from(
        firstRasterGroup(compileJob({ objects: [image], layers: [layer] }, dev))?.sValues ?? [],
      ),
    ).toEqual([498]);
    expect(
      Array.from(
        firstRasterGroup(
          compileJob({ objects: [image], layers: [{ ...layer, passThrough: false }] }, dev),
        )?.sValues ?? [],
      ),
    ).toEqual([0]);
    expect(image.brightness).toBe(100);
  });

  it('applies raster image brightness before grayscale dithering', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      ditherAlgorithm: 'grayscale' as const,
      power: 30,
      linesPerMm: 1,
    };
    const image: RasterImage = { ...rasterObject('gA=='), brightness: 20 };

    const job = compileJob({ objects: [image], layers: [layer] }, dev);

    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([89]);
  });

  it('inverts image-mode luma before emitting raster power when negative image is enabled', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      ditherAlgorithm: 'threshold' as const,
      negativeImage: true,
      linesPerMm: 1,
    };
    const image = twoPixelRasterObject('AP8=');

    const job = compileJob({ objects: [image], layers: [layer] }, dev);

    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([0, 300]);
  });

  it('uses the source image pixel grid when pass-through is enabled', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      ditherAlgorithm: 'threshold' as const,
      passThrough: true,
      linesPerMm: 10,
    };
    const image = twoPixelRasterObject('AP8=');

    const job = compileJob({ objects: [image], layers: [layer] }, dev);
    const raster = firstRasterGroup(job);

    expect(raster?.pixelWidth).toBe(2);
    expect(raster?.pixelHeight).toBe(1);
    expect(Array.from(raster?.sValues ?? [])).toEqual([300, 0]);
  });

  it('carries dot width correction into raster groups bounded by line interval', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      dotWidthCorrectionMm: 0.5,
      linesPerMm: 10,
    };
    const image = twoPixelRasterObject('AP8=');

    const job = compileJob({ objects: [image], layers: [layer] }, dev);

    expect(firstRasterGroup(job)?.dotWidthCorrectionMm).toBeCloseTo(0.1);
  });
});
