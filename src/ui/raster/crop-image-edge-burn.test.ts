import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { compileRasterGroupsForLayer } from '../../core/job/compile-job-raster';
import type { VectorRaster } from '../../core/raster';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { cropMaskedRasterImage } from './crop-image';
import { lumaToBase64, type BitmapFields } from './luma-bitmap';

// Tools audit T1, T17-P2-1 and T17R-P2-1 (ADR-480 Amendment 6). Crop and
// Flatten whitened every source pixel whose centre lay outside the mask. A
// burn cell inside the mask edge then sampled white whenever the source pitch
// was not the line interval (96 dpi at 10 lines/mm: half the outermost cells
// at full power under Negative, a thin ring 17% lighter), and sharpening gave
// the edge a dark rim even on the aligned grid. The baked image must burn
// what the live mask burned: compared here band by band, by each burn cell's
// distance inside an analytic circle, against an independent edge distance.

// Rear-left origin: burn rows are not flipped, so cell (i, j) sits at the
// image's local (i + 0.5, j + 0.5) cell centre plus the translation.
const DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' };
const PLACE = { x: 50, y: 50 };
const S_FULL = 1000;

function circle(cx: number, cy: number, r: number, n = 2880): Vec2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = 0.0137 + (i / n) * 2 * Math.PI;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

function maskOf(contours: ReadonlyArray<ReadonlyArray<Vec2>>): SceneObject {
  const all = contours.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  return {
    kind: 'imported-svg',
    id: 'mask',
    source: 'mask.svg',
    transform: IDENTITY_TRANSFORM,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    paths: [
      {
        color: '#000000',
        polylines: contours.map((points) => ({ points: [...points], closed: true })),
      },
    ],
  };
}

function photo(px: number, sizeMm: number, luma: number, extra: Partial<RasterImage>): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,photo',
    pixelWidth: px,
    pixelHeight: px,
    bounds: { minX: 0, minY: 0, maxX: sizeMm, maxY: sizeMm },
    transform: { ...IDENTITY_TRANSFORM, ...PLACE },
    color: '#808080',
    operationIds: ['op'],
    dither: 'grayscale',
    linesPerMm: 10,
    lumaBase64: lumaToBase64(new Uint8Array(px * px).fill(luma)),
    imageMaskId: 'mask',
    ...extra,
  };
}

function operation(extra: Partial<Layer>): Layer {
  return {
    ...createLayer({ id: 'op', color: '#808080', mode: 'image' }),
    power: 100,
    minPower: 0,
    linesPerMm: 10,
    ditherAlgorithm: 'grayscale',
    dotWidthCorrectionMm: 0,
    ...extra,
  };
}

const encode = (raster: VectorRaster): BitmapFields => ({
  dataUrl: 'data:image/png;base64,baked',
  lumaBase64: lumaToBase64(raster.luma),
});

type BurnCell = { readonly depthMm: number; readonly s: number; readonly areaMm2: number };

function burnCells(
  image: RasterImage,
  mask: SceneObject | null,
  layer: Layer,
  depth: (point: Vec2) => number,
): BurnCell[] {
  const sceneObjects = mask === null ? [image] : [image, mask];
  const { groups } = compileRasterGroupsForLayer([image], layer, DEVICE, { sceneObjects });
  const group = groups[0];
  if (group === undefined) throw new Error('Expected one raster group.');
  const w = group.pixelWidth;
  const h = group.pixelHeight;
  const cw = (image.bounds.maxX - image.bounds.minX) / w;
  const ch = (image.bounds.maxY - image.bounds.minY) / h;
  const cells: BurnCell[] = [];
  for (let j = 0; j < h; j += 1) {
    const streamed = group.sValues.length === w * h ? null : group.rowProvider?.(j);
    const at = (i: number): number =>
      streamed === null ? (group.sValues[j * w + i] ?? 0) : (streamed?.[i] ?? 0);
    for (let i = 0; i < w; i += 1) {
      const centre = {
        x: image.transform.x + image.bounds.minX + (i + 0.5) * cw,
        y: image.transform.y + image.bounds.minY + (j + 0.5) * ch,
      };
      cells.push({ depthMm: depth(centre), s: at(i), areaMm2: cw * ch });
    }
  }
  return cells;
}

type Band = { readonly cells: number; readonly meanS: number; readonly fullShare: number };

function band(cells: ReadonlyArray<BurnCell>, from: number, to: number): Band {
  const inBand = cells.filter((cell) => cell.depthMm >= from && cell.depthMm < to);
  const sum = inBand.reduce((total, cell) => total + cell.s, 0);
  const full = inBand.filter((cell) => cell.s >= S_FULL * 0.999).length;
  return {
    cells: inBand.length,
    meanS: inBand.length === 0 ? 0 : sum / inBand.length,
    fullShare: inBand.length === 0 ? 0 : full / inBand.length,
  };
}

function burnedAreaMm2(cells: ReadonlyArray<BurnCell>): number {
  return cells.reduce((total, cell) => total + (cell.s > 0 ? cell.areaMm2 : 0), 0);
}

const CIRCLE = { cx: 65.0131, cy: 64.9873, r: 12 };
const circleDepth = (p: Vec2) => CIRCLE.r - Math.hypot(p.x - CIRCLE.cx, p.y - CIRCLE.cy);

async function liveAndBaked(
  px: number,
  sizeMm: number,
  luma: number,
  contours: ReadonlyArray<ReadonlyArray<Vec2>>,
  layer: Layer,
  depth: (point: Vec2) => number,
  extra: Partial<RasterImage> = {},
): Promise<{ live: BurnCell[]; baked: BurnCell[] }> {
  const mask = maskOf(contours);
  const source = photo(px, sizeMm, luma, extra);
  const cropped = await cropMaskedRasterImage(source, mask, encode);
  return {
    live: burnCells(source, mask, layer, depth),
    baked: burnCells(cropped, null, layer, depth),
  };
}

describe('Crop and Flatten keep the live mask burn at the mask edge (T17)', () => {
  it('a 96 dpi photo under Negative gains no full-power rim at the edge', async () => {
    // 30 mm at 96 dpi: 113 pixels, 0.265 mm each, burned at 10 lines/mm.
    const { live, baked } = await liveAndBaked(
      113,
      30,
      200,
      [circle(CIRCLE.cx, CIRCLE.cy, CIRCLE.r)],
      operation({ negativeImage: true }),
      circleDepth,
    );
    for (const [from, to] of [
      [0, 0.05],
      [0.05, 0.1],
      [0.1, 0.2],
    ] as const) {
      const before = band(live, from, to);
      const after = band(baked, from, to);
      expect(before.cells).toBeGreaterThan(50);
      expect(before.fullShare).toBe(0);
      // Main: 46% and 24% of these cells burned at full power.
      expect(after.fullShare).toBe(0);
      expect(Math.abs(after.meanS - before.meanS)).toBeLessThan(before.meanS * 0.01);
    }
    expect(band(baked, -1e9, 0).meanS).toBe(0);
  });

  it('a 96 dpi photo, positive, is not lightened at the edge', async () => {
    const { live, baked } = await liveAndBaked(
      113,
      30,
      60,
      [circle(CIRCLE.cx, CIRCLE.cy, CIRCLE.r)],
      operation({}),
      circleDepth,
    );
    for (const [from, to] of [
      [0, 0.05],
      [0.05, 0.1],
    ] as const) {
      const before = band(live, from, to).meanS;
      // Main: 413 against 765 in the outermost band (-46%).
      expect(Math.abs(band(baked, from, to).meanS - before)).toBeLessThan(before * 0.01);
    }
  });

  it('a thin 0.4 mm ring keeps its burn at 96 dpi', async () => {
    const cx = 60.0131;
    const cy = 59.9873;
    const ringDepth = (p: Vec2) => {
      const r = Math.hypot(p.x - cx, p.y - cy);
      return Math.min(6.4 - r, r - 6.0);
    };
    const { live, baked } = await liveAndBaked(
      76,
      20,
      0,
      [circle(cx, cy, 6.4), circle(cx, cy, 6.0)],
      operation({ ditherAlgorithm: 'threshold' }),
      ringDepth,
      { dither: 'threshold' },
    );
    const before = burnedAreaMm2(live);
    expect(before).toBeGreaterThan(15);
    // Main: 12.89 against 15.52 mm2 (-17%).
    expect(Math.abs(burnedAreaMm2(baked) - before)).toBeLessThan(before * 0.02);
    expect(baked.filter((cell) => cell.depthMm < 0 && cell.s > 0)).toHaveLength(0);
  });

  it.each([
    ['100% at radius 1', 100, 1],
    ['the photo recipe, 30% at radius 0.7', 30, 0.7],
    ['60% at the widest radius, 3', 60, 3],
  ] as const)(
    'sharpening (%s) gives the edge no dark rim on the aligned grid',
    async (_name, sharpenAmount, sharpenRadius) => {
      // 254 dpi at 10 lines/mm: source pitch = line interval, the one grid
      // where the centre whitening was exact, yet sharpening still rimmed it.
      const { live, baked } = await liveAndBaked(
        300,
        30,
        128,
        [circle(CIRCLE.cx, CIRCLE.cy, CIRCLE.r)],
        operation({}),
        circleDepth,
        { sharpenAmount, sharpenRadius },
      );
      for (const [from, to] of [
        [0, 0.05],
        [0.05, 0.1],
        [0.1, 0.2],
        [0.2, 0.3],
        [0.3, 1],
      ] as const) {
        const before = band(live, from, to).meanS;
        // Main, 100% / r1: +32% in the outermost band, +23% in the next.
        expect(Math.abs(band(baked, from, to).meanS - before)).toBeLessThan(before * 0.01);
      }
    },
  );
});
