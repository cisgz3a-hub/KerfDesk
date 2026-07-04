import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  createRegistrationLayer,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../scene';
import { createRectangle, createRegistrationBox } from '../shapes';
import { runPreEmitPreflight } from './pre-emit';

function projectWithJig(opts: {
  readonly regOutput: boolean;
  readonly artOutput: boolean;
}): Project {
  const base = createProject();
  const box = createRegistrationBox({ widthMm: 80, heightMm: 40 });
  const art = createRectangle({
    id: 'art',
    color: '#0000ff',
    spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
  });
  let scene = addObject(addObject(base.scene, box), art);
  scene = addLayer(scene, { ...createRegistrationLayer(), output: opts.regOutput });
  scene = addLayer(scene, {
    ...createLayer({ id: '#0000ff', color: '#0000ff' }),
    output: opts.artOutput,
  });
  return { ...base, scene };
}

const COLOR = '#808080';

function projectWithRaster(opts: {
  boundsMax: number;
  linesPerMm: number;
  pixelWidth?: number;
  pixelHeight?: number;
  passThrough?: boolean;
}): Project {
  const base = createProject();
  const raster: RasterImage = {
    kind: 'raster-image',
    id: 'R1',
    color: COLOR,
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: opts.pixelWidth ?? 4,
    pixelHeight: opts.pixelHeight ?? 4,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    bounds: { minX: 0, minY: 0, maxX: opts.boundsMax, maxY: opts.boundsMax },
    transform: IDENTITY_TRANSFORM,
  };
  const layer = {
    ...createLayer({ id: COLOR, color: COLOR, mode: 'image' }),
    linesPerMm: opts.linesPerMm,
    passThrough: opts.passThrough ?? false,
  };
  return { ...base, scene: addLayer(addObject(base.scene, raster), layer) };
}

function projectWithRasterSubLayer(opts: { boundsMax: number; linesPerMm: number }): Project {
  const base = createProject();
  const raster: RasterImage = {
    kind: 'raster-image',
    id: 'R1',
    color: COLOR,
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    bounds: { minX: 0, minY: 0, maxX: opts.boundsMax, maxY: opts.boundsMax },
    transform: IDENTITY_TRANSFORM,
  };
  const lineLayer = createLayer({ id: COLOR, color: COLOR, mode: 'line' });
  const subLayer = createLayerSubLayer(lineLayer, {
    id: 'image-pass',
    label: 'Image',
    settings: {
      ...captureLayerOperationSettings(lineLayer),
      mode: 'image',
      linesPerMm: opts.linesPerMm,
    },
  });
  const layer = { ...lineLayer, subLayers: [subLayer] };
  return { ...base, scene: addLayer(addObject(base.scene, raster), layer) };
}

function projectWithMultipleImageOperations(): Project {
  const base = createProject();
  const raster: RasterImage = {
    kind: 'raster-image',
    id: 'R1',
    color: COLOR,
    source: 'x.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    transform: IDENTITY_TRANSFORM,
  };
  const imageLayer = {
    ...createLayer({ id: COLOR, color: COLOR, mode: 'image' }),
    linesPerMm: 1,
  };
  const subLayer = createLayerSubLayer(imageLayer, {
    id: 'image-pass',
    label: 'Image Pass',
    settings: {
      ...captureLayerOperationSettings(imageLayer),
      mode: 'image',
      linesPerMm: 25,
    },
  });
  return {
    ...base,
    scene: addLayer(addObject(base.scene, raster), { ...imageLayer, subLayers: [subLayer] }),
  };
}

describe('runPreEmitPreflight', () => {
  it('passes a modest raster (10x10mm @ 10 lines/mm = 100x100 px)', () => {
    expect(runPreEmitPreflight(projectWithRaster({ boundsMax: 10, linesPerMm: 10 })).ok).toBe(true);
  });

  it('rejects an oversized raster before compile (300x300mm @ 25 lines/mm = 7500x7500 px)', () => {
    const result = runPreEmitPreflight(projectWithRaster({ boundsMax: 300, linesPerMm: 25 }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'raster-too-large')).toBe(true);
  });

  it('rejects an oversized raster on an image sub-layer before compile', () => {
    const result = runPreEmitPreflight(
      projectWithRasterSubLayer({ boundsMax: 300, linesPerMm: 25 }),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'raster-too-large')).toBe(true);
  });

  it('checks every matching image operation layer, not only the first one', () => {
    const result = runPreEmitPreflight(projectWithMultipleImageOperations());

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'raster-too-large',
        message: expect.stringContaining(`${COLOR}:image-pass image would engrave at 7500x7500 px`),
      }),
    ]);
  });

  it('budgets pass-through rasters from source pixels before compile', () => {
    const result = runPreEmitPreflight(
      projectWithRaster({
        boundsMax: 10,
        linesPerMm: 1,
        pixelWidth: 2500,
        pixelHeight: 2500,
        passThrough: true,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('2500x2500 px');
  });

  it('does not reject a small pass-through source because of large physical bounds', () => {
    const result = runPreEmitPreflight(
      projectWithRaster({
        boundsMax: 300,
        linesPerMm: 25,
        pixelWidth: 10,
        pixelHeight: 10,
        passThrough: true,
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('blocks a registration jig with the box and artwork both set to output', () => {
    const result = runPreEmitPreflight(projectWithJig({ regOutput: true, artOutput: true }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'registration-both-output')).toBe(true);
  });

  it('allows a registration jig burning only one run', () => {
    expect(runPreEmitPreflight(projectWithJig({ regOutput: true, artOutput: false })).ok).toBe(
      true,
    );
    expect(runPreEmitPreflight(projectWithJig({ regOutput: false, artOutput: true })).ok).toBe(
      true,
    );
  });
});
