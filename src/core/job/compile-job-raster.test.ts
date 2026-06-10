// Raster-image compile tests, split from compile-job.test.ts when that file
// hit the 400-line cap. Covers RasterGroup construction: passes, grayscale
// power mapping, lines/mm resample, fail-safe luma, machine orientation
// (origin flips XOR object mirror), transformed bounds, and trace-source
// exclusion.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type SceneObject,
} from '../scene';
import { compileJob } from './compile-job';
import type { Job, RasterGroup } from './job';

const dev = DEFAULT_DEVICE_PROFILE;

function firstRasterGroup(job: Job): RasterGroup | undefined {
  const g = job.groups[0];
  if (g === undefined || g.kind !== 'raster') return undefined;
  return g;
}

function rasterObject(lumaBase64?: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    ...(lumaBase64 !== undefined ? { lumaBase64 } : {}),
  };
}

function imageLayer(overrides: Partial<ReturnType<typeof createLayer>> = {}) {
  return {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
    ditherAlgorithm: 'threshold' as const,
    linesPerMm: 1,
    ...overrides,
  };
}

describe('compileJob raster image groups', () => {
  it('carries raster layer passes into the raster group', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      passes: 3,
    };
    const job = compileJob({ objects: [rasterObject('AP//AA==')], layers: [layer] }, dev);
    expect(firstRasterGroup(job)).toMatchObject({ passes: 3 });
  });

  it('maps grayscale image layers between minPower and power while keeping white off', () => {
    const layer = imageLayer({ ditherAlgorithm: 'grayscale', minPower: 10, power: 30 });
    const image: SceneObject = {
      ...rasterObject('AID/'),
      pixelWidth: 3,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
    };

    const job = compileJob({ objects: [image], layers: [layer] }, dev);

    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([300, 200, 0]);
  });

  it('resamples raster dimensions from image layer lines-per-mm', () => {
    const layer = imageLayer({ linesPerMm: 2 });
    const job = compileJob({ objects: [rasterObject('AP//AA==')], layers: [layer] }, dev);
    const raster = firstRasterGroup(job);
    expect(raster?.pixelWidth).toBe(20);
    expect(raster?.pixelHeight).toBe(10);
    expect(raster?.sValues).toHaveLength(200);
  });

  it('treats missing luma as white so legacy rasters fail safe', () => {
    const job = compileJob({ objects: [rasterObject()], layers: [imageLayer()] }, dev);
    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual(new Array(50).fill(0));
  });

  it('decodes saved luma without relying on a host atob global', () => {
    const originalAtob = globalThis.atob;
    Object.defineProperty(globalThis, 'atob', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const job = compileJob(
        { objects: [rasterObject('AP//AA==')], layers: [imageLayer()] },
        dev,
      );
      expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toContain(300);
    } finally {
      Object.defineProperty(globalThis, 'atob', {
        value: originalAtob,
        configurable: true,
        writable: true,
      });
    }
  });

  it('maps the source bitmap top row to the machine back on front-left devices', () => {
    const imageTopRowBlack: SceneObject = {
      ...rasterObject('AAD//w=='),
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    };

    const job = compileJob({ objects: [imageTopRowBlack], layers: [imageLayer()] }, dev);

    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([0, 0, 300, 300]);
  });

  it('maps the source bitmap left column to machine-right on front-right devices', () => {
    const imageLeftColumnBlack: SceneObject = {
      ...rasterObject('AP8A/w=='),
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    };

    const job = compileJob(
      { objects: [imageLeftColumnBlack], layers: [imageLayer()] },
      { ...dev, origin: 'front-right' },
    );

    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([0, 300, 0, 300]);
  });

  // M35 (AUDIT-2026-06-10): the mirror support must produce exactly the
  // column-mirror of the unmirrored burn — pinned so the preflight relax
  // (mirror no longer rejected) rests on verified output.
  it('burns a mirrored raster as the column-mirror of the unmirrored output', () => {
    const base: SceneObject = {
      ...rasterObject('AP8A/w=='),
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    };
    const mirroredObj: SceneObject = {
      ...base,
      transform: { ...IDENTITY_TRANSFORM, mirrorX: true },
    };

    const plain = compileJob({ objects: [base], layers: [imageLayer()] }, dev);
    const mirrored = compileJob({ objects: [mirroredObj], layers: [imageLayer()] }, dev);

    const p = Array.from(firstRasterGroup(plain)?.sValues ?? []);
    const m = Array.from(firstRasterGroup(mirrored)?.sValues ?? []);
    expect(p).toHaveLength(4);
    expect(m).toEqual([p[1], p[0], p[3], p[2]]);
  });

  // M3 (AUDIT-2026-06-10): dragging a scale handle across the anchor
  // produces a NEGATIVE scale; the canvas (and dither preview) render that
  // as a mirror, so the burn must mirror too — previously the luma was
  // resampled un-mirrored and the preview misrepresented the burn.
  it('treats negative scale as a mirror so the burn matches the canvas', () => {
    const base: SceneObject = {
      ...rasterObject('AP8A/w=='),
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    };
    const negScale: SceneObject = {
      ...base,
      transform: { ...IDENTITY_TRANSFORM, scaleX: -1 },
    };
    const mirrored: SceneObject = {
      ...base,
      transform: { ...IDENTITY_TRANSFORM, mirrorX: true },
    };

    const fromNegScale = compileJob({ objects: [negScale], layers: [imageLayer()] }, dev);
    const fromMirror = compileJob({ objects: [mirrored], layers: [imageLayer()] }, dev);
    const plain = compileJob({ objects: [base], layers: [imageLayer()] }, dev);

    const neg = Array.from(firstRasterGroup(fromNegScale)?.sValues ?? []);
    const mir = Array.from(firstRasterGroup(fromMirror)?.sValues ?? []);
    const pln = Array.from(firstRasterGroup(plain)?.sValues ?? []);
    expect(neg).toEqual(mir);
    expect(neg).not.toEqual(pln);
  });

  it('cancels a negative scale against an explicit mirror on the same axis', () => {
    // scaleY=-1 + mirrorY=true is a double flip — visually upright on the
    // canvas, so the burn must be upright too.
    const base: SceneObject = {
      ...rasterObject('AAD//w=='),
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    };
    const doubleFlip: SceneObject = {
      ...base,
      transform: { ...IDENTITY_TRANSFORM, scaleY: -1, mirrorY: true },
    };

    const a = compileJob({ objects: [doubleFlip], layers: [imageLayer()] }, dev);
    const b = compileJob({ objects: [base], layers: [imageLayer()] }, dev);

    expect(Array.from(firstRasterGroup(a)?.sValues ?? [])).toEqual(
      Array.from(firstRasterGroup(b)?.sValues ?? []),
    );
  });

  it('measures transformed raster bounds from all four corners', () => {
    const rotatedRaster: SceneObject = {
      ...rasterObject('AP//AA=='),
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
    };
    const job = compileJob({ objects: [rotatedRaster], layers: [imageLayer()] }, dev);
    const bounds = firstRasterGroup(job)?.bounds;
    expect(bounds?.minX).toBeCloseTo(-5 * Math.SQRT1_2);
    expect(bounds?.maxX).toBeCloseTo(10 * Math.SQRT1_2);
    expect(bounds?.minY).toBeCloseTo(dev.bedHeight - 15 * Math.SQRT1_2);
    expect(bounds?.maxY).toBeCloseTo(dev.bedHeight);
  });

  it('does not raster-engrave trace-source backing images', () => {
    const source = { ...rasterObject('AP//AA=='), role: 'trace-source' as const };
    const trace: SceneObject = {
      kind: 'traced-image',
      id: 'T1',
      source: 'photo.png',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#000000',
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
      ],
    };
    const layers = [
      createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      { ...createLayer({ id: 'trace', color: '#000000', mode: 'fill' }), hatchSpacingMm: 2 },
    ];
    const job = compileJob({ objects: [source, trace], layers }, dev);
    expect(job.groups.map((g) => g.kind)).toEqual(['fill']);
  });
});
