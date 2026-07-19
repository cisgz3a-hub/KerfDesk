import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  type Layer,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import {
  rasterTraceInputs,
  rasterTraceLinesPerMm,
  sameRasterTraceInputs,
} from './trace-raster-output';

function source(over: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,',
    pixelWidth: 6000,
    pixelHeight: 3000,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    operationIds: ['base'],
    dither: 'threshold',
    linesPerMm: 10,
    ...over,
  };
}

function trace(over: Partial<TracedImage> = {}): TracedImage {
  return {
    kind: 'traced-image',
    id: 'trace',
    source: 'photo.png',
    traceSourceId: 'source',
    traceMode: 'filled-contours',
    tracePixelWidth: 2048,
    tracePixelHeight: 1024,
    bounds: { minX: 0, minY: 0, maxX: 2048, maxY: 1024 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    ...over,
  };
}

function legacyTrace(): TracedImage {
  const {
    tracePixelWidth: _tracePixelWidth,
    tracePixelHeight: _tracePixelHeight,
    ...legacy
  } = trace();
  return legacy;
}

function imageLayer(id: string, linesPerMm: number, over: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id, color: '#808080', mode: 'image' }),
    linesPerMm,
    ...over,
  };
}

function projectWith(image: RasterImage, layers: ReadonlyArray<Layer>) {
  const project = createProject();
  return { ...project, scene: { ...project.scene, objects: [image], layers } };
}

describe('raster trace operation contract', () => {
  it('collects every active Image parent and sublayer and uses the maximum density', () => {
    const base = imageLayer('base', 5);
    const detailSubLayer = createLayerSubLayer(base, {
      id: 'detail',
      label: 'Detail',
      settings: { ...captureLayerOperationSettings(base), mode: 'image', linesPerMm: 14 },
    });
    const sharp = imageLayer('sharp', 20);
    const image = source({ operationIds: ['base', 'sharp'] });
    const inputs = rasterTraceInputs(
      projectWith(image, [{ ...base, subLayers: [detailSubLayer] }, sharp]),
      image.id,
    );

    expect(inputs?.operations).toHaveLength(3);
    expect(
      rasterTraceLinesPerMm(
        image,
        trace(),
        inputs?.operations.map(({ operation }) => operation) ?? [],
      ),
    ).toBe(20);
  });

  it('detects a change to a secondary active Image operation', () => {
    const image = source({ operationIds: ['base', 'sharp'] });
    const base = imageLayer('base', 5);
    const sharp = imageLayer('sharp', 20);
    const inputs = rasterTraceInputs(projectWith(image, [base, sharp]), image.id);
    if (inputs === null) throw new Error('missing raster trace inputs');

    expect(
      sameRasterTraceInputs(projectWith(image, [base, { ...sharp, linesPerMm: 18 }]), inputs),
    ).toBe(false);
  });

  it('preserves a Pass Through trace grid under non-uniform source scaling', () => {
    const image = source({
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 0.5, rotationDeg: 37 },
    });
    const operation = imageLayer('base', 5, { passThrough: true });

    expect(
      rasterTraceLinesPerMm(image, trace({ tracePixelWidth: 2000, tracePixelHeight: 500 }), [
        operation,
      ]),
    ).toBe(20);
  });

  it('rejects a Pass Through trace grid above the supported density', () => {
    const image = source({ pixelWidth: 100, pixelHeight: 50 });
    const operation = imageLayer('base', 5, { passThrough: true });

    expect(() =>
      rasterTraceLinesPerMm(image, trace({ tracePixelWidth: 2600, tracePixelHeight: 1300 }), [
        operation,
      ]),
    ).toThrow(/Pass Through needs 26\.00 lines\/mm.*supported 25 lines\/mm/);
  });

  it('falls back to the source grid for legacy traces without grid metadata', () => {
    const image = source({
      pixelWidth: 2000,
      pixelHeight: 1000,
      transform: { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 },
    });
    const operation = imageLayer('base', 5, { passThrough: true });

    expect(rasterTraceLinesPerMm(image, legacyTrace(), [operation])).toBe(10);
  });
});
