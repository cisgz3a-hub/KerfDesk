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
  type SceneObject,
} from '../scene';
import { createRegistrationBox } from '../shapes';
import { createRectangle } from '../shapes/primitives';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { runPreEmitPreflight } from './pre-emit';

it('rejects canonical curve geometry above the bounded machine segment budget', () => {
  const base = createProject();
  const color = '#ff0000';
  const segments = Array.from({ length: 100_001 }, (_, index) => ({
    kind: 'line' as const,
    to: { x: index % 100, y: Math.floor(index / 100) },
  }));
  const object: SceneObject = {
    kind: 'imported-svg',
    id: 'over-budget',
    source: 'over-budget.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 1001 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [{ points: [{ x: 0, y: 0 }], closed: false }],
        curves: [{ start: { x: 0, y: 0 }, segments, closed: false }],
      },
    ],
  };
  const scene = addLayer(addObject(base.scene, object), createLayer({ id: 'curve', color }));
  expect(runPreEmitPreflight({ ...base, scene }).issues).toContainEqual(
    expect.objectContaining({ code: 'vector-segment-budget-exceeded' }),
  );
});

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
  ditherAlgorithm?: 'threshold' | 'floyd-steinberg';
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
    ditherAlgorithm: opts.ditherAlgorithm ?? 'floyd-steinberg',
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
  it('leaves a finite controlled seek feed above the device ceiling for Job Review', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      maxFeed: 1000,
      controlledLaserOffTravelFeedMmPerMin: 1001,
    });

    expect(runPreEmitPreflight(project)).toEqual({ ok: true, issues: [] });
  });

  it('leaves a finite scan-offset override above the profile cap for Job Review', () => {
    const project = createProject();
    const layer = {
      ...createLayer({ id: 'offset-fill', color: '#ff0000', mode: 'fill' }),
      bidirectionalScanOffsetMm: 4.01,
    };

    expect(
      runPreEmitPreflight({
        ...project,
        scene: { ...project.scene, layers: [layer] },
      }),
    ).toEqual({
      ok: true,
      issues: [],
    });
  });

  it('refuses only non-executable controlled feeds and scan offsets before compile', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      controlledLaserOffTravelFeedMmPerMin: 0,
    });
    const layer = {
      ...createLayer({ id: 'invalid-offset', color: '#ff0000', mode: 'fill' }),
      bidirectionalScanOffsetMm: Number.NaN,
    };

    expect(
      runPreEmitPreflight({
        ...project,
        scene: { ...project.scene, layers: [layer] },
      }).issues,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'speed-out-of-range' }),
        expect.objectContaining({
          code: 'scan-offset-out-of-range',
          message: expect.stringContaining('must be finite'),
        }),
      ]),
    );
  });

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

  it('allows a previously rejected pass-through raster when local dither can stream rows', () => {
    const result = runPreEmitPreflight(
      projectWithRaster({
        boundsMax: 10,
        linesPerMm: 1,
        pixelWidth: 2500,
        pixelHeight: 2500,
        passThrough: true,
        ditherAlgorithm: 'threshold',
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('still rejects the same raster when error diffusion requires full-image state', () => {
    const result = runPreEmitPreflight(
      projectWithRaster({
        boundsMax: 10,
        linesPerMm: 1,
        pixelWidth: 2500,
        pixelHeight: 2500,
        passThrough: true,
        ditherAlgorithm: 'floyd-steinberg',
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('materialized working set');
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

  it('leaves a registration jig with the box and artwork both set to output for Frame review', () => {
    const result = runPreEmitPreflight(projectWithJig({ regOutput: true, artOutput: true }));
    expect(result.ok).toBe(true);
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
