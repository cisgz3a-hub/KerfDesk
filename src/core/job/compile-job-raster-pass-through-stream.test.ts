import { expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { grblStrategy } from '../output/grbl-strategy';
import { compileJob } from './compile-job';
import type * as RasterBudget from '../raster/raster-budget';

// Exercise the real compiler's streaming branch with a tiny, inspectable grid.
vi.mock('../raster/raster-budget', async (importOriginal) => ({
  ...(await importOriginal<typeof RasterBudget>()),
  STREAMED_RASTER_PIXEL_THRESHOLD: 2,
}));

it('streams original pass-through pixels, preserving placement and the selected power', () => {
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    color: '#808080',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,unused',
    lumaBase64: 'AID/',
    pixelWidth: 3,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
    transform: { ...IDENTITY_TRANSFORM, x: 10, y: 20 },
    brightness: 100,
    contrast: -100,
    gamma: 5,
    dither: 'threshold',
    linesPerMm: 30,
  };
  const layer = {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
    passThrough: true,
    negativeImage: true,
    ditherAlgorithm: 'ordered' as const,
    power: 50,
    linesPerMm: 30,
  };
  const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const };
  const job = compileJob({ objects: [image], layers: [layer] }, device);
  const raster = job.groups[0];
  expect(raster?.kind).toBe('raster');
  if (raster?.kind !== 'raster') throw new Error('Missing raster');
  expect(raster).toMatchObject({ pixelWidth: 3, pixelHeight: 1 });
  expect(raster.sValues).toHaveLength(0);
  expect(raster.bounds).toEqual({ minX: 10, minY: 20, maxX: 13, maxY: 21 });
  expect(Array.from(raster.rowProvider?.(0) ?? [])).toEqual([500, 249, 0]);
  const output = grblStrategy.emit(job, device, {
    compactMotionWords: false,
    finishPosition: null,
  });
  expect(output).toContain('S500');
  expect(output).toContain('S249');
});
