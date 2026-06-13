import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type RasterImage,
} from '../scene';
import { applyJobOrigin, compileJob, computeJobBounds, type JobOriginPlacement } from './index';
import { computeFrameBounds } from './frame-bounds';

function vectorObject(paths: ImportedSvg['paths']): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'vector-1',
    source: 'fixture.svg',
    bounds: { minX: 0, minY: 0, maxX: 320, maxY: 320 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

function rasterObject(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'image-1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 20, minY: 30, maxX: 70, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    lumaBase64: 'AAAAAAAAAAA=',
    ...overrides,
  };
}

describe('computeFrameBounds', () => {
  it('matches compiled bounds while ignoring hidden vector colors', () => {
    const scene = {
      ...EMPTY_SCENE,
      layers: [
        createLayer({ id: 'red', color: '#ff0000', mode: 'line' }),
        { ...createLayer({ id: 'blue', color: '#0000ff', mode: 'line' }), output: false },
      ],
      objects: [
        vectorObject([
          {
            color: '#ff0000',
            polylines: [
              {
                closed: true,
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                  { x: 10, y: 10 },
                  { x: 0, y: 10 },
                ],
              },
            ],
          },
          {
            color: '#0000ff',
            polylines: [
              {
                closed: true,
                points: [
                  { x: 200, y: 200 },
                  { x: 320, y: 200 },
                  { x: 320, y: 320 },
                  { x: 200, y: 320 },
                ],
              },
            ],
          },
        ]),
      ],
    };

    const compiledBounds = computeJobBounds(compileJob(scene, DEFAULT_DEVICE_PROFILE));

    expect(computeFrameBounds(scene, DEFAULT_DEVICE_PROFILE)).toEqual(compiledBounds);
    expect(computeFrameBounds(scene, DEFAULT_DEVICE_PROFILE)).toEqual({
      minX: 0,
      minY: 390,
      maxX: 10,
      maxY: 400,
    });
  });

  it('matches compiled bounds for image layers without reading raster pixels', () => {
    const scene = {
      ...EMPTY_SCENE,
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
      objects: [rasterObject()],
    };

    expect(computeFrameBounds(scene, DEFAULT_DEVICE_PROFILE)).toEqual(
      computeJobBounds(compileJob(scene, DEFAULT_DEVICE_PROFILE)),
    );
  });

  it('skips trace-source backing rasters just like compileJob', () => {
    const scene = {
      ...EMPTY_SCENE,
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
      objects: [rasterObject({ role: 'trace-source' })],
    };

    expect(computeFrameBounds(scene, DEFAULT_DEVICE_PROFILE)).toBeNull();
  });

  it('applies the same job-origin placement offset as the compiled job path', () => {
    const scene = {
      ...EMPTY_SCENE,
      layers: [createLayer({ id: 'red', color: '#ff0000', mode: 'line' })],
      objects: [
        vectorObject([
          {
            color: '#ff0000',
            polylines: [
              {
                closed: true,
                points: [
                  { x: 0, y: 0 },
                  { x: 20, y: 0 },
                  { x: 20, y: 20 },
                  { x: 0, y: 20 },
                ],
              },
            ],
          },
        ]),
      ],
    };
    const placement: JobOriginPlacement = {
      startFrom: 'current-position',
      anchor: 'center',
      currentPosition: { x: 100, y: 120 },
    };
    const compiled = compileJob(scene, DEFAULT_DEVICE_PROFILE);

    expect(computeFrameBounds(scene, DEFAULT_DEVICE_PROFILE, { jobOrigin: placement })).toEqual(
      computeJobBounds(applyJobOrigin(compiled, placement)),
    );
  });

  it('returns null when all output layers are disabled', () => {
    const scene = {
      ...createProject().scene,
      layers: [{ ...createLayer({ id: 'red', color: '#ff0000', mode: 'line' }), output: false }],
      objects: [
        vectorObject([
          {
            color: '#ff0000',
            polylines: [
              {
                closed: false,
                points: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                ],
              },
            ],
          },
        ]),
      ],
    };

    expect(computeFrameBounds(scene, DEFAULT_DEVICE_PROFILE)).toBeNull();
  });
});
