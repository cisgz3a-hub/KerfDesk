// Shared luma-buffer helpers for raster engraving.
//
// Raster import stores one source luma grid, but image-mode output is governed
// by the layer's requested lines/mm. This module resamples the stored source
// to the burn grid compileJob and raster Preview both consume.

import type { DitherAlgorithm } from '../scene';

const WHITE_LUMA = 255;
// Two different quantities that both happen to floor at 1. MIN_PIXEL_DIM is a
// PIXEL COUNT (a burn grid always has at least one row/column);
// MIN_COMPILED_LINES_PER_MM is a DENSITY in lines/mm. They were one constant,
// which read as a unit error and hid the fact that the compiled density floor
// is the number every display of "line interval" has to agree with.
const MIN_PIXEL_DIM = 1;
export const MIN_COMPILED_LINES_PER_MM = 1;

/**
 * The lines/mm the compiler will actually burn for a requested density.
 *
 * This is the ONLY density floor in the raster path: it is deliberately looser
 * than the recommended range in raster-units, because clamping an operator's
 * stored value would silently retime their job. Displays must resolve through
 * here so the panel, Job Review and the emitted program agree.
 */
export function compiledLinesPerMm(linesPerMm: number): number {
  if (!Number.isFinite(linesPerMm)) return MIN_COMPILED_LINES_PER_MM;
  return Math.max(MIN_COMPILED_LINES_PER_MM, linesPerMm);
}

export type LumaRaster = {
  readonly luma: Uint8Array;
  readonly width: number;
  readonly height: number;
};

export function pixelExtentForMm(mm: number, linesPerMm: number): number {
  const px = Math.round(Math.max(0, mm) * compiledLinesPerMm(linesPerMm));
  return Math.max(MIN_PIXEL_DIM, px);
}

export function whiteLuma(length: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, length));
  out.fill(WHITE_LUMA);
  return out;
}

/**
 * How stored luma reaches the burn grid (ADR-359).
 *
 * 'area': on an axis where the burn grid is COARSER than the source, each burn
 * cell takes the exact area-weighted mean of the source pixels it covers. A
 * single centre sample there silently deleted any white line or dot narrower
 * than one cell — or kept it a whole cell wide — depending only on where the
 * sample landed, while the canvas drew every line. Tone-rendering dithers
 * (error diffusion, ordered, grayscale) turn that mean into proportional
 * texture.
 *
 * 'nearest': one centre sample per cell. Threshold keeps it: averaging then
 * cutting at 128 would erase every stroke of EITHER polarity covering half a
 * cell or less and posterise pre-dithered art, where a centre sample at least
 * keeps a share of the strokes (widened to a cell).
 *
 * On an axis the grid does not downscale, both kernels take the centre sample,
 * byte-identical to the former nearest-neighbour output.
 */
export type BurnGridKernel = 'area' | 'nearest';

export function burnGridKernel(algorithm: DitherAlgorithm): BurnGridKernel {
  return algorithm === 'threshold' ? 'nearest' : 'area';
}

export function resampleLuma(
  input: LumaRaster,
  targetWidth: number,
  targetHeight: number,
  kernel: BurnGridKernel = 'area',
): Uint8Array {
  const width = Math.max(MIN_PIXEL_DIM, Math.floor(targetWidth));
  const height = Math.max(MIN_PIXEL_DIM, Math.floor(targetHeight));
  const writeRow = createRowWriter(input, width, height, kernel);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) writeRow(y, out.subarray(y * width, (y + 1) * width));
  return out;
}

/**
 * Row-at-a-time form of resampleLuma for the streamed raster path, which must
 * stay byte-identical to the materialized one: both run this same arithmetic.
 */
export function createLumaRowResampler(
  input: LumaRaster,
  targetWidth: number,
  targetHeight: number,
  kernel: BurnGridKernel = 'area',
): (targetY: number) => Uint8Array {
  const width = Math.max(MIN_PIXEL_DIM, Math.floor(targetWidth));
  const height = Math.max(MIN_PIXEL_DIM, Math.floor(targetHeight));
  const writeRow = createRowWriter(input, width, height, kernel);
  return (targetY: number): Uint8Array => {
    const row = new Uint8Array(width);
    writeRow(targetY, row);
    return row;
  };
}

type RowWriter = (targetY: number, out: Uint8Array) => void;

function createRowWriter(
  input: LumaRaster,
  width: number,
  height: number,
  kernel: BurnGridKernel,
): RowWriter {
  if (input.width <= 0 || input.height <= 0 || input.luma.length === 0) {
    return (_targetY, out) => out.fill(WHITE_LUMA);
  }
  const columns = axisTaps(input.width, width, kernel);
  const rows = axisTaps(input.height, height, kernel);
  const clampRow = (targetY: number): number =>
    Math.min(height - 1, Math.max(0, Math.floor(targetY)));
  if (columns.centreOnly && rows.centreOnly) {
    // Every cell is one weight-1 tap, so a direct lookup gives the same bytes
    // without the weighted-sum loop.
    return (targetY, out) => {
      const rowBase = (rows.index[clampRow(targetY)] ?? 0) * input.width;
      for (let x = 0; x < width; x += 1) {
        out[x] = input.luma[rowBase + (columns.index[x] ?? 0)] ?? WHITE_LUMA;
      }
    };
  }
  const sourceRows = createSourceRowCache(input, columns, maxTapsPerTarget(rows));
  // One accumulator for the resampler's lifetime; each row clears it.
  const sums = new Float64Array(width);
  return (targetY, out) => {
    const y = clampRow(targetY);
    sums.fill(0);
    for (let r = rows.offset[y] ?? 0; r < (rows.offset[y + 1] ?? 0); r += 1) {
      addWeighted(sums, sourceRows(rows.index[r] ?? 0), rows.weight[r] ?? 0);
    }
    const rowTotal = rows.total[y] ?? 1;
    for (let x = 0; x < width; x += 1) {
      out[x] = Math.round((sums[x] ?? 0) / ((columns.total[x] ?? 1) * rowTotal));
    }
  };
}

function addWeighted(sums: Float64Array, reduced: Float64Array, weight: number): void {
  for (let x = 0; x < sums.length; x += 1) sums[x] = (sums[x] ?? 0) + (reduced[x] ?? 0) * weight;
}

// Column-weighted sums of source rows, kept for the few rows the next burn row
// can share: neighbouring burn rows straddle the same boundary source row, and
// reducing it once instead of once per burn row roughly halves a mild
// downscale. Keyed by source row, so any access order gives the same bytes.
function createSourceRowCache(
  input: LumaRaster,
  columns: AxisTaps,
  capacity: number,
): (sourceRow: number) => Float64Array {
  const cached = new Map<number, Float64Array>();
  return (sourceRow) => {
    const hit = cached.get(sourceRow);
    if (hit !== undefined) return hit;
    const reduced =
      (cached.size > capacity ? evictOldest(cached) : undefined) ??
      new Float64Array(columns.total.length);
    reduceSourceRow(input.luma, sourceRow * input.width, columns, reduced);
    cached.set(sourceRow, reduced);
    return reduced;
  };
}

// Removes the least recently added row and hands back its buffer for reuse.
function evictOldest(cached: Map<number, Float64Array>): Float64Array | undefined {
  const oldest = cached.keys().next().value;
  if (oldest === undefined) return undefined;
  const buffer = cached.get(oldest);
  cached.delete(oldest);
  return buffer;
}

function maxTapsPerTarget(taps: AxisTaps): number {
  let most = 1;
  for (let t = 0; t + 1 < taps.offset.length; t += 1) {
    most = Math.max(most, (taps.offset[t + 1] ?? 0) - (taps.offset[t] ?? 0));
  }
  return most;
}

// One source row's column-weighted sums, written over `out`.
function reduceSourceRow(
  luma: Uint8Array,
  rowBase: number,
  columns: AxisTaps,
  out: Float64Array,
): void {
  const { offset, index, weight } = columns;
  for (let x = 0; x < out.length; x += 1) {
    let sum = 0;
    const end = offset[x + 1] ?? 0;
    for (let c = offset[x] ?? 0; c < end; c += 1) {
      sum += (luma[rowBase + (index[c] ?? 0)] ?? WHITE_LUMA) * (weight[c] ?? 0);
    }
    out[x] = sum;
  }
}

// Per-axis source taps for each target index, stored flat: target t reads
// source indices index[offset[t] .. offset[t+1]) with the matching weights,
// and total[t] is their sum. A centre-only axis has exactly one weight-1 tap
// per target, at index[t].
type AxisTaps = {
  readonly centreOnly: boolean;
  readonly offset: Int32Array;
  readonly index: Int32Array;
  readonly weight: Float64Array;
  readonly total: Float64Array;
};

function axisTaps(sourceExtent: number, targetExtent: number, kernel: BurnGridKernel): AxisTaps {
  const indices: number[] = [];
  const weights: number[] = [];
  const offset = new Int32Array(targetExtent + 1);
  const total = new Float64Array(targetExtent);
  const downscales = kernel === 'area' && sourceExtent > targetExtent;
  for (let t = 0; t < targetExtent; t += 1) {
    offset[t] = indices.length;
    if (!downscales) {
      // Centre sample — the exact nearest-neighbour formula this replaced.
      indices.push(
        Math.min(sourceExtent - 1, Math.floor(((t + 0.5) * sourceExtent) / targetExtent)),
      );
      weights.push(1);
      total[t] = 1;
      continue;
    }
    const lo = (t * sourceExtent) / targetExtent;
    const hi = Math.min(sourceExtent, ((t + 1) * sourceExtent) / targetExtent);
    let covered = 0;
    for (let i = Math.floor(lo); i < Math.min(sourceExtent, Math.ceil(hi)); i += 1) {
      const w = Math.min(i + 1, hi) - Math.max(i, lo);
      if (w <= 0) continue;
      indices.push(i);
      weights.push(w);
      covered += w;
    }
    if (covered > 0) {
      total[t] = covered;
      continue;
    }
    indices.push(Math.min(sourceExtent - 1, Math.floor(lo)));
    weights.push(1);
    total[t] = 1;
  }
  offset[targetExtent] = indices.length;
  return {
    centreOnly: !downscales,
    offset,
    index: Int32Array.from(indices),
    weight: Float64Array.from(weights),
    total,
  };
}
