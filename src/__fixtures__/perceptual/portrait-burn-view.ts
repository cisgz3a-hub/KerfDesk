// Perceptual test harness — how a burned portrait looks (ADR-685).
//
// Compiles the astronaut's head through the shipping raster compiler, renders
// every burned cell as a round laser dot of a given diameter in cells (1.6 is
// the 4040's 0.16 mm spot on a 0.1 mm interval, ADR-670) by supersampling,
// then compares what a viewer sees (reflectance under a 1.2-cell Gaussian) with
// the photo on screen (its linear light under the same blur), in CIE L*.
// Burned material is taken as black and the surface as white: a material's own
// darkening is ADR-670's tone calibration, not this harness.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure apart from the file read.

import type { DitherAlgorithm, RasterImage } from '../../core/scene';
import { photoLuma } from './photo-luma';
import { compileRasterFixture } from './raster-burn-fixtures';

const ASSET = 'src/__fixtures__/perceptual/assets/astronaut.png';
const SOURCE_EDGE = 512;
/** Hair, face and collar of the portrait, in source pixels, burned 1:1. */
const HEAD = { x: 140, y: 8, size: 192 };
const LINES_PER_MM = 10;
const SUPERSAMPLE = 5;
export const VIEW_SIGMA_CELLS = 1.2;
/** Source luma at or above this counts as a highlight for `highlightSpeckle`. */
const HIGHLIGHT_LUMA = 215;

export const PORTRAIT_EDGE = HEAD.size;

export type PortraitTones = Pick<
  RasterImage,
  'brightness' | 'contrast' | 'gamma' | 'sharpenAmount' | 'sharpenRadius'
>;

export type PortraitScore = {
  /** Mean L* the burn is lighter (+) or darker (-) than the photo. */
  readonly bias: number;
  readonly meanAbsoluteError: number;
  /** Correlation of the fine band (blur 1.2 minus blur 4 cells) with the photo's. */
  readonly detail: number;
};

let decoded: Uint8Array | null = null;

export function portraitHeadLuma(): Uint8Array {
  if (decoded !== null) return decoded;
  const full = photoLuma({ path: ASSET, width: SOURCE_EDGE, height: SOURCE_EDGE });
  const out = new Uint8Array(HEAD.size * HEAD.size);
  for (let y = 0; y < HEAD.size; y += 1) {
    const row = (HEAD.y + y) * SOURCE_EDGE + HEAD.x;
    out.set(full.subarray(row, row + HEAD.size), y * HEAD.size);
  }
  decoded = out;
  return out;
}

export function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(y: number): number {
  return 255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
}

export function lstar(y: number): number {
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

export function gaussianBlur(grid: Float64Array, edge: number, sigma: number): Float64Array {
  const half = Math.ceil(3 * sigma);
  const weights: number[] = [];
  for (let k = -half; k <= half; k += 1) weights.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const total = weights.reduce((a, b) => a + b, 0);
  const pass = (source: Float64Array, horizontal: boolean): Float64Array => {
    const out = new Float64Array(source.length);
    for (let y = 0; y < edge; y += 1) {
      for (let x = 0; x < edge; x += 1) {
        let sum = 0;
        for (let k = -half; k <= half; k += 1) {
          const xx = horizontal ? Math.min(edge - 1, Math.max(0, x + k)) : x;
          const yy = horizontal ? y : Math.min(edge - 1, Math.max(0, y + k));
          sum += (source[yy * edge + xx] ?? 0) * (weights[k + half] ?? 0);
        }
        out[y * edge + x] = sum / total;
      }
    }
    return out;
  };
  return pass(pass(grid, true), false);
}

/** Burn darkness per cell (0..1) in scene row order, from the shipping compiler. */
export function portraitBurn(
  algorithm: DitherAlgorithm,
  tones: PortraitTones = {},
  luma = portraitHeadLuma(),
): Float64Array {
  const edge = HEAD.size;
  const fixture = compileRasterFixture({
    luma,
    width: edge,
    height: edge,
    sceneBounds: {
      minX: 40,
      minY: 40,
      maxX: 40 + edge / LINES_PER_MM,
      maxY: 40 + edge / LINES_PER_MM,
    },
    ditherAlgorithm: algorithm,
    linesPerMm: LINES_PER_MM,
    powerPercent: 100,
    imageSettings: tones,
  });
  const out = new Float64Array(edge * edge);
  for (let y = 0; y < edge; y += 1) {
    for (let x = 0; x < edge; x += 1) {
      // The default origin flips machine Y; undo it so rows read in scene order.
      out[y * edge + x] = (fixture.group.sValues[(edge - 1 - y) * edge + x] ?? 0) / fixture.sMax;
    }
  }
  return out;
}

/** Exact reflectance (1 = untouched) of round dots `dotCells` wide, by supersampling. */
export function exactDotReflectance(burn: Float64Array, dotCells: number): Float64Array {
  const edge = HEAD.size;
  const sub = edge * SUPERSAMPLE;
  const covered = new Uint8Array(sub * sub);
  for (let cy = 0; cy < edge; cy += 1) {
    for (let cx = 0; cx < edge; cx += 1) {
      if ((burn[cy * edge + cx] ?? 0) >= 0.5) stampDisc(covered, sub, cx, cy, dotCells);
    }
  }
  return coveredReflectance(covered, edge);
}

function stampDisc(covered: Uint8Array, sub: number, cx: number, cy: number, dotCells: number) {
  const radius = (dotCells * SUPERSAMPLE) / 2;
  const reach = Math.ceil(radius);
  const ox = (cx + 0.5) * SUPERSAMPLE;
  const oy = (cy + 0.5) * SUPERSAMPLE;
  const firstX = Math.max(0, Math.floor(ox - reach));
  const lastX = Math.min(sub - 1, Math.ceil(ox + reach));
  for (let sy = Math.max(0, Math.floor(oy - reach)); sy <= Math.min(sub - 1, oy + reach); sy += 1) {
    for (let sx = firstX; sx <= lastX; sx += 1) {
      const dx = sx + 0.5 - ox;
      const dy = sy + 0.5 - oy;
      if (dx * dx + dy * dy <= radius * radius) covered[sy * sub + sx] = 1;
    }
  }
}

function coveredReflectance(covered: Uint8Array, edge: number): Float64Array {
  const sub = edge * SUPERSAMPLE;
  const out = new Float64Array(edge * edge);
  for (let cy = 0; cy < edge; cy += 1) {
    for (let cx = 0; cx < edge; cx += 1) {
      let n = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          n += covered[(cy * SUPERSAMPLE + sy) * sub + cx * SUPERSAMPLE + sx] ?? 0;
        }
      }
      out[cy * edge + cx] = 1 - n / (SUPERSAMPLE * SUPERSAMPLE);
    }
  }
  return out;
}

/** Score what a viewer sees of `reflectance` against the photo. */
export function scorePortrait(reflectance: Float64Array, luma = portraitHeadLuma()): PortraitScore {
  const edge = HEAD.size;
  const truth = Array.from(
    gaussianBlur(Float64Array.from(luma, srgbToLinear), edge, VIEW_SIGMA_CELLS),
    lstar,
  );
  const seen = Array.from(gaussianBlur(reflectance, edge, VIEW_SIGMA_CELLS), lstar);
  let bias = 0;
  let error = 0;
  for (let i = 0; i < truth.length; i += 1) {
    const d = (seen[i] ?? 0) - (truth[i] ?? 0);
    bias += d;
    error += Math.abs(d);
  }
  const band = (values: number[]): Float64Array => {
    const grid = Float64Array.from(values);
    const coarse = gaussianBlur(grid, edge, 4);
    return grid.map((v, i) => v - (coarse[i] ?? 0));
  };
  const a = band(truth);
  const b = band(seen);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    ab += (a[i] ?? 0) * (b[i] ?? 0);
    aa += (a[i] ?? 0) ** 2;
    bb += (b[i] ?? 0) ** 2;
  }
  return {
    bias: bias / truth.length,
    meanAbsoluteError: error / truth.length,
    detail: ab / Math.sqrt(aa * bb),
  };
}

/** Share of highlight cells (source luma >= 215) that burn a dot. */
export function highlightSpeckle(burn: Float64Array, luma = portraitHeadLuma()): number {
  let highlights = 0;
  let dots = 0;
  for (let i = 0; i < luma.length; i += 1) {
    if ((luma[i] ?? 0) < HIGHLIGHT_LUMA) continue;
    highlights += 1;
    if ((burn[i] ?? 0) >= 0.5) dots += 1;
  }
  return highlights === 0 ? 0 : dots / highlights;
}
