import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { rasterPreparationTooComplex } from '../../core/job/raster-preparation-complexity';
import { classifyCanvasPreparation } from './canvas-preparation-policy';

const COLOR = '#808080';

describe('interactive raster canvas preparation routing', () => {
  it.each([1254, 4096])(
    'routes an ordinary %ipx image off-thread below the core advisory',
    (side) => {
      const project = rasterProject([raster(side)]);
      expect(rasterPreparationTooComplex(project)).toBe(false);
      expect(classifyCanvasPreparation(project)).toBe('background-worker');
    },
  );

  it('counts source decode even when a large image occupies a tiny output grid', () => {
    const project = rasterProject([
      { ...raster(4096), transform: { ...IDENTITY_TRANSFORM, scaleX: 0.001, scaleY: 0.001 } },
    ]);
    expect(classifyCanvasPreparation(project)).toBe('background-worker');
  });

  it('keeps a modest source and output grid on the direct path', () => {
    expect(classifyCanvasPreparation(rasterProject([raster(256)]))).toBe('direct');
  });

  it('counts effective output scale, rotation and passes even with a tiny source', () => {
    const small = raster(8);
    const scaled = { ...small, transform: { ...IDENTITY_TRANSFORM, scaleX: 63, scaleY: 63 } };
    expect(classifyCanvasPreparation(rasterProject([scaled]))).toBe('background-worker');
    const square = {
      ...small,
      bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    };
    expect(classifyCanvasPreparation(rasterProject([square]))).toBe('direct');
    expect(
      classifyCanvasPreparation(
        rasterProject([{ ...square, transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 } }]),
      ),
    ).toBe('background-worker');
    expect(
      classifyCanvasPreparation(rasterProject([square], [{ ...imageLayer(), passes: 2 }])),
    ).toBe('background-worker');
  });

  it('uses object-local mode, density and pass-through over their operation defaults', () => {
    const largeOutput = {
      ...raster(8),
      bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
      operationOverride: { byOperation: { image: { mode: 'image' as const, linesPerMm: 3 } } },
    };
    expect(
      classifyCanvasPreparation(rasterProject([largeOutput], [{ ...imageLayer(), mode: 'line' }])),
    ).toBe('background-worker');
    expect(
      classifyCanvasPreparation(
        rasterProject([{ ...largeOutput, operationOverride: { passThrough: true } }]),
      ),
    ).toBe('direct');
    expect(
      classifyCanvasPreparation(
        rasterProject([{ ...raster(4096), operationOverride: { mode: 'line' } }]),
      ),
    ).toBe('direct');
  });

  it('aggregates active raster work while selected output excludes unselected images', () => {
    const first = raster(256, 'first');
    const second = raster(256, 'second');
    const project = rasterProject([first, second]);
    expect(classifyCanvasPreparation(project)).toBe('background-worker');
    expect(
      classifyCanvasPreparation(project, {
        cutSelectedGraphics: true,
        useSelectionOrigin: false,
        selectedObjectIds: ['first'],
      }),
    ).toBe('direct');
  });

  it('counts source decoding once while retaining every enabled output operation', () => {
    const source = raster(400);
    const tinyOutput = {
      ...source,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      operationIds: ['image', 'second'],
    };
    const operations = [imageLayer(), { ...imageLayer(), id: 'second' }];
    expect(classifyCanvasPreparation(rasterProject([tinyOutput], operations))).toBe('direct');
    const outputs = { ...tinyOutput, bounds: { minX: 0, minY: 0, maxX: 25, maxY: 25 } };
    expect(classifyCanvasPreparation(rasterProject([outputs], operations))).toBe(
      'background-worker',
    );
  });

  it('respects enabled image sublayers, output bindings and output independently of visibility', () => {
    const source = raster(1254);
    const parent = { ...imageLayer(), mode: 'line' as const };
    const child = createLayerSubLayer(imageLayer(), { id: 'child', label: 'Image', enabled: true });
    expect(
      classifyCanvasPreparation(rasterProject([source], [{ ...parent, subLayers: [child] }])),
    ).toBe('background-worker');
    expect(
      classifyCanvasPreparation(
        rasterProject([source], [{ ...parent, subLayers: [{ ...child, enabled: false }] }]),
      ),
    ).toBe('direct');
    expect(
      classifyCanvasPreparation(rasterProject([source], [{ ...imageLayer(), visible: false }])),
    ).toBe('background-worker');
    expect(
      classifyCanvasPreparation(rasterProject([source], [{ ...imageLayer(), output: false }])),
    ).toBe('direct');
    expect(
      classifyCanvasPreparation(rasterProject([{ ...source, operationIds: ['unbound'] }])),
    ).toBe('direct');
  });

  it('ignores retained trace-source bitmaps and the laser-only raster pipeline in CNC', () => {
    expect(
      classifyCanvasPreparation(rasterProject([{ ...raster(4096), role: 'trace-source' }])),
    ).toBe('direct');
    expect(
      classifyCanvasPreparation({
        ...rasterProject([raster(4096)]),
        machine: DEFAULT_CNC_MACHINE_CONFIG,
      }),
    ).toBe('direct');
  });

  it('classifies only metadata without decoding or inspecting image payloads', () => {
    const source = raster(1254);
    Object.defineProperties(source, {
      dataUrl: {
        get: () => {
          throw new Error('unexpected image payload read');
        },
      },
      lumaBase64: {
        get: () => {
          throw new Error('unexpected luma payload read');
        },
      },
    });
    expect(classifyCanvasPreparation(rasterProject([source]))).toBe('background-worker');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not throw from routing malformed source dimensions (%s)',
    (width) => {
      const project = rasterProject([{ ...raster(8), pixelWidth: width }]);
      expect(() => classifyCanvasPreparation(project)).not.toThrow();
    },
  );
});

function raster(side: number, id = 'raster'): RasterImage {
  return {
    kind: 'raster-image',
    id,
    color: COLOR,
    source: 'routing.png',
    dataUrl: 'data:image/png;base64,metadata-only',
    pixelWidth: side,
    pixelHeight: side,
    bounds: { minX: 0, minY: 0, maxX: side / 10, maxY: side / 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['image'],
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function imageLayer(): Layer {
  return { ...createLayer({ id: 'image', color: COLOR, mode: 'image' }), linesPerMm: 10 };
}

function rasterProject(
  objects: readonly RasterImage[],
  layers: readonly Layer[] = [imageLayer()],
): Project {
  return { ...createProject(), scene: { objects, layers } };
}
