// Sharpening at engraving resolution (ADR-671) on a real portrait.
//
// Area resampling (ADR-359) gives each burn cell the exact mean of the source
// it covers. That box filter keeps tone honest, but it gives up a little of
// the finest detail the burn grid could still hold, the scale of eyes, lashes
// and hair. The reference is a Lanczos-3 reduction of the same face, an
// independent and sharper resampling filter written in this file. The score
// is the mid-band detail (Gaussian sigma 0.8 minus sigma 2 cells, also written
// here) the compiled burn grid holds against that reference, read through the
// shipping compiler with Grayscale output so the burn-grid tone can be
// recovered from S.
//
// Measured on this face: area resampling keeps 95-98% of the reference's
// mid-band detail from 2:1 to 8:1. A light sharpen (30%, 0.7 cells) brings it
// to about 101% and lowers the error against the reference; 50-80% overshoots
// it, which is enhancement, not recovery. A Jarvis burn then checks through
// the emitted G-code that sharpening leaves the engraved tones as faithful.

import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../ci-budget';
import { photoLuma } from './photo-luma';
import { compileRasterFixture } from './raster-burn-fixtures';
import { scoreRasterBurn } from './raster-burn-scoring';

const ASSET_PATH = 'src/__fixtures__/perceptual/assets/astronaut.png';
const SOURCE_EDGE = 512;
// Hair, eyes and smile of the portrait, in source pixels.
const FACE = { x: 150, y: 20, size: 160 };
const LIGHT_SHARPEN = { sharpenAmount: 30, sharpenRadius: 0.7 };
const BUDGET_MS = ciBudgetMs(20_000, 60_000);

// The face placed at 1 line/mm: 80 mm is an exact 2:1 area reduction, 40 mm 4:1.
type Placement = { readonly edgeMm: number; readonly cells: ReadonlyArray<number> };
// Density cells must be whole scan rows (raster-photo-fidelity.test.ts): the
// scored window is the placement plus 8 mm on each side.
const PLACEMENTS: ReadonlyArray<Placement> = [
  { edgeMm: 80, cells: [12, 24] },
  { edgeMm: 40, cells: [7, 14] },
];

let decodedFace: Uint8Array | null = null;

function faceLuma(): Uint8Array {
  if (decodedFace !== null) return decodedFace;
  const full = photoLuma({ path: ASSET_PATH, width: SOURCE_EDGE, height: SOURCE_EDGE });
  const out = new Uint8Array(FACE.size * FACE.size);
  for (let y = 0; y < FACE.size; y += 1) {
    const row = (FACE.y + y) * SOURCE_EDGE + FACE.x;
    out.set(full.subarray(row, row + FACE.size), y * FACE.size);
  }
  decodedFace = out;
  return out;
}

function compileFace(
  placement: Placement,
  ditherAlgorithm: 'grayscale' | 'jarvis',
  imageSettings = {},
): ReturnType<typeof compileRasterFixture> {
  return compileRasterFixture({
    luma: faceLuma(),
    width: FACE.size,
    height: FACE.size,
    sceneBounds: { minX: 40, minY: 40, maxX: 40 + placement.edgeMm, maxY: 40 + placement.edgeMm },
    ditherAlgorithm,
    powerPercent: 100,
    imageSettings,
  });
}

// Burn-grid tone from Grayscale S (sMin 0: S = sMax * (255 - v) / 255), with
// the default origin's machine-Y flip undone so rows read in scene order.
function burnGridLuma(placement: Placement, imageSettings = {}): Float64Array {
  const fixture = compileFace(placement, 'grayscale', imageSettings);
  const edge = placement.edgeMm;
  expect(fixture.group).toMatchObject({ pixelWidth: edge, pixelHeight: edge });
  const out = new Float64Array(edge * edge);
  for (let y = 0; y < edge; y += 1) {
    for (let x = 0; x < edge; x += 1) {
      const s = fixture.group.sValues[(edge - 1 - y) * edge + x] ?? 0;
      out[y * edge + x] = 255 * (1 - s / fixture.sMax);
    }
  }
  return out;
}

function lanczos3(x: number): number {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

type Taps = ReadonlyArray<readonly [index: number, weight: number]>;

function lanczosTaps(target: number, edge: number, targetEdge: number): Taps {
  const scale = edge / targetEdge;
  const centre = (target + 0.5) * scale - 0.5;
  const taps: Array<readonly [number, number]> = [];
  let total = 0;
  for (let i = Math.floor(centre - 3 * scale); i <= Math.ceil(centre + 3 * scale); i += 1) {
    const w = lanczos3((i - centre) / scale);
    if (w === 0) continue;
    taps.push([Math.min(edge - 1, Math.max(0, i)), w]);
    total += w;
  }
  return taps.map(([i, w]) => [i, w / total] as const);
}

function gaussianTaps(target: number, edge: number, sigma: number): Taps {
  const half = Math.ceil(3 * sigma);
  const taps: Array<readonly [number, number]> = [];
  let total = 0;
  for (let k = -half; k <= half; k += 1) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma));
    taps.push([Math.min(edge - 1, Math.max(0, target + k)), w]);
    total += w;
  }
  return taps.map(([i, w]) => [i, w / total] as const);
}

// Separable filter of a square grid, one tap list per output index.
function filter(
  grid: ArrayLike<number>,
  edge: number,
  targetEdge: number,
  taps: (target: number) => Taps,
): Float64Array {
  const table = Array.from({ length: targetEdge }, (_, t) => taps(t));
  const rows = new Float64Array(edge * targetEdge);
  for (let y = 0; y < edge; y += 1) {
    for (let t = 0; t < targetEdge; t += 1) {
      let sum = 0;
      for (const [i, w] of table[t] ?? []) sum += (grid[y * edge + i] ?? 0) * w;
      rows[y * targetEdge + t] = sum;
    }
  }
  const out = new Float64Array(targetEdge * targetEdge);
  for (let t = 0; t < targetEdge; t += 1) {
    for (let x = 0; x < targetEdge; x += 1) {
      let sum = 0;
      for (const [i, w] of table[t] ?? []) sum += (rows[i * targetEdge + x] ?? 0) * w;
      out[t * targetEdge + x] = sum;
    }
  }
  return out;
}

function lanczosReference(edge: number): Float64Array {
  const reduced = filter(faceLuma(), FACE.size, edge, (t) => lanczosTaps(t, FACE.size, edge));
  return reduced.map((v) => Math.max(0, Math.min(255, v)));
}

function midBand(grid: Float64Array, edge: number): Float64Array {
  const fine = filter(grid, edge, edge, (t) => gaussianTaps(t, edge, 0.8));
  const coarse = filter(grid, edge, edge, (t) => gaussianTaps(t, edge, 2));
  return fine.map((v, i) => v - (coarse[i] ?? 0));
}

function meanAbs(values: Float64Array): number {
  return values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length;
}

function meanAbsDiff(a: Float64Array, b: Float64Array): number {
  return a.reduce((sum, v, i) => sum + Math.abs(v - (b[i] ?? 0)), 0) / a.length;
}

function mean(values: Float64Array): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe('sharpening at engraving resolution — real portrait', () => {
  it(
    'restores the face detail area resampling softens, without shifting tone',
    () => {
      for (const placement of PLACEMENTS) {
        const edge = placement.edgeMm;
        const reference = midBand(lanczosReference(edge), edge);
        const plainGrid = burnGridLuma(placement);
        const sharpGrid = burnGridLuma(placement, LIGHT_SHARPEN);
        const plain = midBand(plainGrid, edge);
        const sharpened = midBand(sharpGrid, edge);

        // Area resampling holds less detail than the sharper reference...
        expect(meanAbs(plain) / meanAbs(reference)).toBeLessThan(0.99);
        // ...a light sharpen brings it back to the reference, not past it...
        expect(meanAbs(sharpened) / meanAbs(reference)).toBeGreaterThan(0.99);
        expect(meanAbs(sharpened) / meanAbs(reference)).toBeLessThan(1.05);
        // ...closer to the reference detail cell by cell...
        expect(meanAbsDiff(sharpened, reference)).toBeLessThan(meanAbsDiff(plain, reference));
        // ...and the face keeps its overall tone.
        expect(Math.abs(mean(sharpGrid) - mean(plainGrid))).toBeLessThan(0.5);
      }
    },
    BUDGET_MS,
  );

  it(
    'keeps the engraved Jarvis tones as faithful as without sharpening',
    () => {
      const truth = {
        luma: faceLuma(),
        width: FACE.size,
        height: FACE.size,
        tone: 'linear' as const,
      };
      for (const placement of PLACEMENTS) {
        for (const cells of placement.cells) {
          const plain = scoreRasterBurn(compileFace(placement, 'jarvis'), truth, cells);
          const sharpened = scoreRasterBurn(
            compileFace(placement, 'jarvis', LIGHT_SHARPEN),
            truth,
            cells,
          );
          // Error diffusion re-routes every later dot once any input moves, so
          // a coarse cell can shift by dither noise: allow half a percent of
          // full density. Measured: at most +0.004, on the 49-cell grid.
          expect(sharpened.meanAbsoluteError).toBeLessThan(plain.meanAbsoluteError + 0.005);
          expect(sharpened.correlation).toBeGreaterThan(plain.correlation - 0.002);
          expect(Math.abs(sharpened.predictedMean - plain.predictedMean)).toBeLessThan(0.005);
        }
      }
    },
    BUDGET_MS,
  );
});
