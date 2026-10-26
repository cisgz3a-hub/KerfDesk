// Sharpening at engraving resolution (ADR-671) through the real compiler.
//
// One file drives both raster branches: the streaming threshold is read
// through a getter, so the same image compiles materialized and then streamed
// row by row, and the two must agree byte for byte with sharpening on.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type * as RasterBudget from '../raster/raster-budget';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
  type SceneObject,
} from '../scene';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import type { RasterGroup } from './job';

const streaming = vi.hoisted(() => ({ threshold: 4_000_000 }));
vi.mock('../raster/raster-budget', async (importOriginal) => ({
  ...(await importOriginal<typeof RasterBudget>()),
  get STREAMED_RASTER_PIXEL_THRESHOLD() {
    return streaming.threshold;
  },
}));

const SOURCE_W = 53;
const SOURCE_H = 41;
const SHARPEN = { sharpenAmount: 140, sharpenRadius: 1.3 };

// Smooth shading with a hard diagonal edge, denser than the burn grid.
function sourceLuma(): Uint8Array {
  const luma = new Uint8Array(SOURCE_W * SOURCE_H);
  for (let y = 0; y < SOURCE_H; y += 1) {
    for (let x = 0; x < SOURCE_W; x += 1) {
      const shade = 120 + 80 * Math.sin(x / 4.7) * Math.cos(y / 3.9);
      luma[y * SOURCE_W + x] = Math.round(x + y > 50 ? shade * 0.55 : shade);
    }
  }
  return luma;
}

function photo(overrides: Partial<RasterImage> = {}): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    color: '#808080',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,unused',
    pixelWidth: SOURCE_W,
    pixelHeight: SOURCE_H,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 15 },
    transform: { ...IDENTITY_TRANSFORM, x: 60, y: 60 },
    dither: 'jarvis',
    linesPerMm: 1.5,
    lumaBase64: Buffer.from(sourceLuma()).toString('base64'),
    ...overrides,
  };
}

function imageLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
    ditherAlgorithm: 'jarvis',
    linesPerMm: 1.5,
    ...overrides,
  };
}

// An ellipse over the middle of the photo, in scene coordinates.
function ellipseMask(): SceneObject {
  const points = Array.from({ length: 49 }, (_, i) => {
    const t = (i / 48) * 2 * Math.PI;
    return { x: 70 + 7 * Math.cos(t), y: 67.5 + 5 * Math.sin(t) };
  });
  return {
    kind: 'imported-svg',
    id: 'mask',
    source: 'mask.svg',
    bounds: { minX: 60, minY: 60, maxX: 80, maxY: 75 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ points, closed: true }] }],
  };
}

function groupValues(group: RasterGroup): number[] {
  if (group.rowProvider === undefined) return Array.from(group.sValues);
  const out: number[] = [];
  for (let y = 0; y < group.pixelHeight; y += 1) out.push(...group.rowProvider(y));
  return out;
}

function compile(
  image: RasterImage,
  layer: Layer = imageLayer(),
  device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
  sceneObjects: ReadonlyArray<SceneObject> = [image],
): { readonly streamed: boolean; readonly values: number[][] } {
  const { groups } = compileRasterGroupsForLayer([image], layer, device, { sceneObjects });
  expect(groups.length).toBeGreaterThan(0);
  return {
    streamed: groups.every((group) => group.rowProvider !== undefined),
    values: groups.map(groupValues),
  };
}

function bothBranches(...args: Parameters<typeof compile>) {
  streaming.threshold = 4_000_000;
  const materialized = compile(...args);
  streaming.threshold = 2;
  const streamed = compile(...args);
  streaming.threshold = 4_000_000;
  expect(materialized.streamed).toBe(false);
  expect(streamed.streamed).toBe(true);
  return { materialized: materialized.values, streamed: streamed.values };
}

type Case = {
  readonly name: string;
  readonly image?: Partial<RasterImage>;
  readonly layer?: Partial<Layer>;
  readonly device?: Partial<DeviceProfile>;
  readonly masked?: boolean;
};

const CASES: ReadonlyArray<Case> = [
  { name: 'upright, front-left origin' },
  { name: 'upright, rear-right origin', device: { origin: 'rear-right' } },
  {
    name: 'mirrored',
    image: { transform: { ...IDENTITY_TRANSFORM, x: 60, y: 60, mirrorX: true } },
  },
  { name: 'masked', masked: true },
  { name: 'independent-row dither', layer: { ditherAlgorithm: 'ordered' } },
  {
    name: 'rotated 30 degrees',
    image: { transform: { ...IDENTITY_TRANSFORM, x: 60, y: 60, rotationDeg: 30 } },
  },
  {
    name: 'quarter turn',
    image: { transform: { ...IDENTITY_TRANSFORM, x: 60, y: 60, rotationDeg: 90 } },
  },
  {
    name: 'rotated and masked',
    masked: true,
    image: { transform: { ...IDENTITY_TRANSFORM, x: 60, y: 60, rotationDeg: 30 } },
  },
  { name: 'scanned at 45 degrees', layer: { imageScanAngleDeg: 45 } },
  { name: 'source coarser than the grid', layer: { linesPerMm: 4 } },
];

function compileCase(testCase: Case, sharpen: Partial<RasterImage>) {
  const image = photo({
    ...testCase.image,
    ...sharpen,
    ...(testCase.masked === true ? { imageMaskId: 'mask' } : {}),
  });
  return bothBranches(
    image,
    imageLayer(testCase.layer),
    { ...DEFAULT_DEVICE_PROFILE, ...testCase.device },
    testCase.masked === true ? [image, ellipseMask()] : [image],
  );
}

beforeEach(() => {
  streaming.threshold = 4_000_000;
});

describe('compile with sharpening at engraving resolution (ADR-671)', () => {
  it.each(CASES)('streams the materialized bytes: $name', (testCase) => {
    const sharpened = compileCase(testCase, SHARPEN);
    const plain = compileCase(testCase, {});

    expect(sharpened.streamed).toEqual(sharpened.materialized);
    // Sharpening is live on every path, not silently skipped.
    expect(sharpened.materialized).not.toEqual(plain.materialized);
  });

  it('is byte-identical when off, whatever radius is stored', () => {
    for (const testCase of CASES) {
      const absent = compileCase(testCase, {});
      const zero = compileCase(testCase, { sharpenAmount: 0, sharpenRadius: 2.5 });
      expect(zero.materialized).toEqual(absent.materialized);
      expect(zero.streamed).toEqual(absent.streamed);
    }
  });

  it('leaves Pass-through pixels untouched', () => {
    const layer = imageLayer({ passThrough: true });
    expect(compile(photo(SHARPEN), layer).values).toEqual(compile(photo(), layer).values);
  });

  it('sharpens before masking, so the mask edge gains no halo', () => {
    const layer = imageLayer({ ditherAlgorithm: 'grayscale' });
    const masked = photo({ ...SHARPEN, imageMaskId: 'mask' });
    const [inside] = compile(masked, layer, DEFAULT_DEVICE_PROFILE, [masked, ellipseMask()]).values;
    const [unmasked] = compile(photo(SHARPEN), layer).values;
    let kept = 0;
    let cleared = 0;
    inside?.forEach((value, i) => {
      if (value === 0) {
        cleared += 1;
        return;
      }
      // Every burned cell inside the mask is exactly the unmasked sharpened cell.
      expect(value).toBe(unmasked?.[i]);
      kept += 1;
    });
    expect(kept).toBeGreaterThan(100);
    expect(cleared).toBeGreaterThan(100);
  });
});
