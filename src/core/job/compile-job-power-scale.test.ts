import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage, type SceneObject } from '../scene';
import { compileJob } from './compile-job';

const dev = DEFAULT_DEVICE_PROFILE;

function vectorObject(args: {
  readonly id: string;
  readonly color: string;
  readonly x: number;
  readonly powerScale?: number;
}): SceneObject {
  return {
    kind: 'imported-svg',
    id: args.id,
    source: `${args.id}.svg`,
    bounds: { minX: args.x, minY: 0, maxX: args.x + 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: args.color,
        polylines: [
          {
            closed: false,
            points: [
              { x: args.x, y: 0 },
              { x: args.x + 1, y: 0 },
            ],
          },
        ],
      },
    ],
    ...(args.powerScale !== undefined ? { powerScale: args.powerScale } : {}),
  };
}

function rasterObject(powerScale?: number): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 3,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 1,
    lumaBase64: 'AID/',
    ...(powerScale !== undefined ? { powerScale } : {}),
  };
}

describe('compileJob object power scale', () => {
  it('keeps default same-layer vector objects in one cut group', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), power: 30 };
    const job = compileJob(
      {
        objects: [
          vectorObject({ id: 'O1', color: '#ff0000', x: 0 }),
          vectorObject({ id: 'O2', color: '#ff0000', x: 2 }),
        ],
        layers: [layer],
      },
      dev,
    );

    expect(job.groups).toHaveLength(1);
    expect(job.groups[0]).toMatchObject({ kind: 'cut', power: 30 });
  });

  it('splits same-layer vector output when objects use different power scales', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), power: 30 };
    const job = compileJob(
      {
        objects: [
          vectorObject({ id: 'half', color: '#ff0000', x: 0, powerScale: 50 }),
          vectorObject({ id: 'full', color: '#ff0000', x: 2 }),
        ],
        layers: [layer],
      },
      dev,
    );

    expect(job.groups).toHaveLength(2);
    expect(job.groups.map((group) => group.power)).toEqual([15, 30]);
  });

  it('scales grayscale raster max and min power for one image object', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      ditherAlgorithm: 'grayscale' as const,
      minPower: 10,
      power: 30,
      linesPerMm: 1,
    };
    const job = compileJob({ objects: [rasterObject(50)], layers: [layer] }, dev);
    const raster = job.groups[0];

    expect(raster?.kind).toBe('raster');
    if (raster?.kind === 'raster') {
      expect(raster.power).toBe(15);
      expect(Array.from(raster.sValues)).toEqual([150, 100, 0]);
    }
  });
});
