// Rotated raster compile — a rotated image must burn rotated. Scan rows stay
// horizontal in machine space, so the compiler samples each machine pixel
// center back through the object transform into the source bitmap. Before
// this fix the sampler ignored rotationDeg and burned the unrotated bitmap
// stretched into the rotated bounding box (canvas showed rotation, burn
// preview and G-code did not).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage, type SceneObject } from '../scene';
import { compileJob } from './compile-job';
import type { Job, RasterGroup } from './job';

const dev = DEFAULT_DEVICE_PROFILE;

function firstRasterGroup(job: Job): RasterGroup | undefined {
  const g = job.groups[0];
  if (g === undefined || g.kind !== 'raster') return undefined;
  return g;
}

function rasterObject(lumaBase64: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 10,
    lumaBase64,
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

describe('compileJob rotated raster images', () => {
  it('burns a 90-degree rotated raster with the content rotated, not stretched', () => {
    // Top row black, bottom row white. Unrotated this compiles to
    // [0, 0, 300, 300] (top row lands at machine back on front-left devices).
    // Rotated 90° the black stripe must become a vertical column.
    const topRowBlack: SceneObject = {
      ...rasterObject('AAD//w=='),
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 90 },
    };

    const job = compileJob({ objects: [topRowBlack], layers: [imageLayer()] }, dev);

    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([0, 300, 0, 300]);
  });

  it('burns a 180-degree rotation identically to a double mirror', () => {
    const base = rasterObject('AP8A/w==');
    const rotated: SceneObject = {
      ...base,
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 180 },
    };
    const doubleMirror: SceneObject = {
      ...base,
      transform: { ...IDENTITY_TRANSFORM, mirrorX: true, mirrorY: true },
    };

    const fromRotation = compileJob({ objects: [rotated], layers: [imageLayer()] }, dev);
    const fromMirror = compileJob({ objects: [doubleMirror], layers: [imageLayer()] }, dev);

    const r = Array.from(firstRasterGroup(fromRotation)?.sValues ?? []);
    const m = Array.from(firstRasterGroup(fromMirror)?.sValues ?? []);
    expect(r).toHaveLength(4);
    expect(r).toEqual(m);
  });

  it('keeps the bounding-box padding around a 45-degree rotation unburned', () => {
    const allBlack: SceneObject = {
      ...rasterObject('AAAAAA=='),
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
    };

    const job = compileJob({ objects: [allBlack], layers: [imageLayer()] }, dev);
    const raster = firstRasterGroup(job);

    expect(raster?.pixelWidth).toBe(3);
    expect(raster?.pixelHeight).toBe(3);
    const s = Array.from(raster?.sValues ?? []);
    // AABB corners lie outside the rotated square: laser off.
    expect([s[0], s[2], s[6], s[8]]).toEqual([0, 0, 0, 0]);
    // The rotated square's center is black: full layer power.
    expect(s[4]).toBe(300);
  });

  it('rotates streamed row-provider rasters too', () => {
    const largeBlack: SceneObject = {
      ...rasterObject('AA=='),
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 2100, maxY: 2100 },
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
    };

    const job = compileJob({ objects: [largeBlack], layers: [imageLayer()] }, dev);
    const raster = firstRasterGroup(job);

    expect(raster?.sValues).toHaveLength(0);
    const width = raster?.pixelWidth ?? 0;
    const height = raster?.pixelHeight ?? 0;
    expect(width).toBeGreaterThan(2100);
    const topRow = raster?.rowProvider?.(0);
    const centerRow = raster?.rowProvider?.(Math.floor(height / 2));
    // The AABB corner is outside the rotated square; its center is inside.
    expect(topRow?.[0]).toBe(0);
    expect(centerRow?.[Math.floor(width / 2)]).toBe(300);
  });
});
