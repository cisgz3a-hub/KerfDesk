import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../scene';
import { runPreEmitPreflight } from './pre-emit';

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

describe('runPreEmitPreflight', () => {
  it('passes a modest raster (10x10mm @ 10 lines/mm = 100x100 px)', () => {
    expect(runPreEmitPreflight(projectWithRaster({ boundsMax: 10, linesPerMm: 10 })).ok).toBe(true);
  });

  it('rejects an oversized raster before compile (300x300mm @ 25 lines/mm = 7500x7500 px)', () => {
    const result = runPreEmitPreflight(projectWithRaster({ boundsMax: 300, linesPerMm: 25 }));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'raster-too-large')).toBe(true);
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
});
