import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { createRectangle } from '../shapes';
import { compileJob } from './compile-job';

function raster(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 4,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: Buffer.from([0, 0, 0, 0]).toString('base64'),
    ...overrides,
  };
}

describe('compileJob raster image masks', () => {
  it('omits masked-out pixels from emitted raster power values', () => {
    const mask = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 2, heightMm: 1, cornerRadiusMm: 0 },
    });
    const shiftedMask = {
      ...mask,
      transform: { ...IDENTITY_TRANSFORM, x: 1, y: 0 },
    };
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      passThrough: true,
      ditherAlgorithm: 'threshold' as const,
    };

    const job = compileJob(
      { objects: [raster({ imageMaskId: 'M1' }), shiftedMask], layers: [layer] },
      DEFAULT_DEVICE_PROFILE,
    );
    const group = job.groups[0];

    expect(group?.kind).toBe('raster');
    expect(group?.kind === 'raster' ? Array.from(group.sValues) : []).toEqual([0, 300, 300, 0]);
  });
});
