import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../scene';
import {
  rasterPreparationTooComplex,
  rasterPreparationWorkUnits,
} from './raster-preparation-complexity';

const COLOR = '#808080';

function projectWithRaster(opts: {
  readonly boundsMax: number;
  readonly linesPerMm: number;
  readonly passes?: number;
  readonly passThrough?: boolean;
  readonly sourceSide?: number;
}): Project {
  const base = createProject();
  const side = opts.sourceSide ?? 4;
  const raster: RasterImage = {
    kind: 'raster-image',
    id: 'R1',
    color: COLOR,
    source: 'x.png',
    dataUrl: 'data:image/png;base64,unused',
    pixelWidth: side,
    pixelHeight: side,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
    bounds: { minX: 0, minY: 0, maxX: opts.boundsMax, maxY: opts.boundsMax },
    transform: IDENTITY_TRANSFORM,
  };
  const layer = {
    ...createLayer({ id: COLOR, color: COLOR, mode: 'image' }),
    linesPerMm: opts.linesPerMm,
    passes: opts.passes ?? 1,
    passThrough: opts.passThrough ?? false,
  };
  return { ...base, scene: addLayer(addObject(base.scene, raster), layer) };
}

describe('rasterPreparationWorkUnits', () => {
  it('counts target pixels times passes for an image operation', () => {
    const project = projectWithRaster({ boundsMax: 10, linesPerMm: 10, passes: 3 });
    expect(rasterPreparationWorkUnits(project)).toBe(100 * 100 * 3);
    expect(rasterPreparationTooComplex(project)).toBe(false);
  });

  it('pauses the live surfaces above the work-unit budget (7500x7500 px)', () => {
    const project = projectWithRaster({ boundsMax: 300, linesPerMm: 25 });
    expect(rasterPreparationTooComplex(project)).toBe(true);
  });

  it('multiplies passes into the budget decision', () => {
    const single = projectWithRaster({ boundsMax: 300, linesPerMm: 15 });
    // 4500x4500 = 20.25M work units — under budget at one pass...
    expect(rasterPreparationTooComplex(single)).toBe(false);
    // ...over it at three passes (60.75M).
    expect(
      rasterPreparationTooComplex(projectWithRaster({ boundsMax: 300, linesPerMm: 15, passes: 3 })),
    ).toBe(true);
  });

  it('uses source pixels for pass-through, not physical bounds', () => {
    const project = projectWithRaster({
      boundsMax: 300,
      linesPerMm: 25,
      passThrough: true,
      sourceSide: 10,
    });
    expect(rasterPreparationWorkUnits(project)).toBe(100);
  });

  it('counts nothing on a CNC project (image mode is laser-only)', () => {
    const project = projectWithRaster({ boundsMax: 300, linesPerMm: 25 });
    const cnc: Project = { ...project, machine: DEFAULT_CNC_MACHINE_CONFIG };
    expect(rasterPreparationWorkUnits(cnc)).toBe(0);
  });
});
