// Perceptual test harness — source bitmap → the burn density it demands.
//
// The other half of the raster fidelity measurement. gcode-burn-density.ts
// says what the emitted program WILL burn; this says what the source image
// ASKED for, on the same machine-mm cell grid, so the two are subtractable.
//
// Tone transfer — the honest part. A cell's demanded density is the mean ink
// fraction of the source pixels covering it, but "ink fraction" is only
// well-defined relative to the dither the layer uses:
//
//   'linear'    ink = (255 - luma) / 255. Correct for the 'grayscale' dither
//               (S is a linear function of luma) and for every error-diffusion
//               kernel and for 'ordered', all of which are density-preserving:
//               they trade tone for local dot density, so a coarse cell mean
//               converges on the grey value. This is exactly why the metric
//               must be read at cell scale and never per pixel.
//
//   'threshold' ink = 1 below the cutoff, 0 above. Correct for the 'threshold'
//               dither, which is NOT density-preserving — it sends a 60%-grey
//               region entirely to white. Scoring a threshold burn against a
//               'linear' truth measures the dither's design, not the pipeline's
//               fidelity, and would fail on correct output.
//
// Choosing the wrong tone for the layer's dither makes the score meaningless,
// so it is a required decision at the call site, not a default that silently
// works most of the time.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

import type { DensityField, MachineRect } from './gcode-burn-density';

export type SourceTone = 'linear' | 'threshold';

export type DensityGrid = {
  readonly window: MachineRect;
  readonly cellsX: number;
  readonly cellsY: number;
};

export type ImageDensityTruthInput = {
  readonly luma: Uint8Array;
  readonly width: number;
  readonly height: number;
  // Machine-mm rectangle the image occupies (the compiled group's bounds).
  readonly rect: MachineRect;
  // Where source row 0 lands in machine Y. An image's top row burns at the
  // BACK of the bed on a front-left origin, which is machine max Y — hence
  // the default. Pass 'min-y' for a device origin or object mirror that
  // flips the raster (see compile-job-raster.ts orientRasterLumaForMachine).
  readonly rowZeroAt?: 'max-y' | 'min-y';
  readonly columnZeroAt?: 'min-x' | 'max-x';
  readonly tone: SourceTone;
  // 'threshold' only. Matches core/raster/dither.ts DEFAULT_THRESHOLD.
  readonly thresholdLuma?: number;
};

const WHITE_LUMA = 255;
const DEFAULT_THRESHOLD_LUMA = 128;

type Range = { readonly lo: number; readonly hi: number };
type CellSize = { readonly cellWidthMm: number; readonly cellHeightMm: number };
type PixelPatch = { readonly xRange: Range; readonly yRange: Range; readonly ink: number };

export function imageDensityTruth(input: ImageDensityTruthInput, grid: DensityGrid): DensityField {
  const accumulated = new Float64Array(grid.cellsX * grid.cellsY);
  const size: CellSize = {
    cellWidthMm: (grid.window.maxX - grid.window.minX) / grid.cellsX,
    cellHeightMm: (grid.window.maxY - grid.window.minY) / grid.cellsY,
  };
  const pixelWidthMm = (input.rect.maxX - input.rect.minX) / input.width;
  const pixelHeightMm = (input.rect.maxY - input.rect.minY) / input.height;
  for (let row = 0; row < input.height; row += 1) {
    const yRange = pixelYRange(input, row, pixelHeightMm);
    for (let col = 0; col < input.width; col += 1) {
      const ink = inkFraction(input, input.luma[row * input.width + col] ?? WHITE_LUMA);
      if (ink <= 0) continue;
      spreadPixel(accumulated, grid, size, {
        xRange: pixelXRange(input, col, pixelWidthMm),
        yRange,
        ink,
      });
    }
  }
  const cellAreaMm2 = size.cellWidthMm * size.cellHeightMm;
  for (let i = 0; i < accumulated.length; i += 1) {
    accumulated[i] = (accumulated[i] ?? 0) / cellAreaMm2;
  }
  return { cellsX: grid.cellsX, cellsY: grid.cellsY, window: grid.window, data: accumulated };
}

function inkFraction(input: ImageDensityTruthInput, luma: number): number {
  if (input.tone === 'threshold') {
    return luma < (input.thresholdLuma ?? DEFAULT_THRESHOLD_LUMA) ? 1 : 0;
  }
  return (WHITE_LUMA - luma) / WHITE_LUMA;
}

function pixelXRange(input: ImageDensityTruthInput, col: number, pixelWidthMm: number): Range {
  if (input.columnZeroAt === 'max-x') {
    return {
      lo: input.rect.maxX - (col + 1) * pixelWidthMm,
      hi: input.rect.maxX - col * pixelWidthMm,
    };
  }
  return {
    lo: input.rect.minX + col * pixelWidthMm,
    hi: input.rect.minX + (col + 1) * pixelWidthMm,
  };
}

function pixelYRange(input: ImageDensityTruthInput, row: number, pixelHeightMm: number): Range {
  if (input.rowZeroAt === 'min-y') {
    return {
      lo: input.rect.minY + row * pixelHeightMm,
      hi: input.rect.minY + (row + 1) * pixelHeightMm,
    };
  }
  return {
    lo: input.rect.maxY - (row + 1) * pixelHeightMm,
    hi: input.rect.maxY - row * pixelHeightMm,
  };
}

// Area-weighted box splat of one source pixel across the cells it overlaps.
// Exact rather than point-sampled, so a cell grid that does not divide the
// pixel grid evenly still integrates to the right total ink.
function spreadPixel(
  accumulated: Float64Array,
  grid: DensityGrid,
  size: CellSize,
  patch: PixelPatch,
): void {
  const cols = overlappingCells(patch.xRange, grid.window.minX, size.cellWidthMm, grid.cellsX);
  const rows = overlappingCells(patch.yRange, grid.window.minY, size.cellHeightMm, grid.cellsY);
  for (let row = rows.first; row <= rows.last; row += 1) {
    const cellY = grid.window.minY + row * size.cellHeightMm;
    const overlapY = overlapLength(patch.yRange, cellY, size.cellHeightMm);
    if (overlapY <= 0) continue;
    for (let col = cols.first; col <= cols.last; col += 1) {
      const cellX = grid.window.minX + col * size.cellWidthMm;
      const overlapX = overlapLength(patch.xRange, cellX, size.cellWidthMm);
      if (overlapX <= 0) continue;
      const i = row * grid.cellsX + col;
      accumulated[i] = (accumulated[i] ?? 0) + patch.ink * overlapX * overlapY;
    }
  }
}

function overlappingCells(
  range: Range,
  originMm: number,
  cellSizeMm: number,
  cellCount: number,
): { readonly first: number; readonly last: number } {
  return {
    first: Math.max(0, Math.floor((range.lo - originMm) / cellSizeMm)),
    last: Math.min(cellCount - 1, Math.floor((range.hi - originMm) / cellSizeMm)),
  };
}

function overlapLength(range: Range, cellLo: number, cellSizeMm: number): number {
  return Math.min(range.hi, cellLo + cellSizeMm) - Math.max(range.lo, cellLo);
}
