// raster-budget — a cheap, pure estimate of what a raster engrave will cost to
// compile, so a huge image is REJECTED before compileRasterGroup allocates the
// resampled luma buffer, the dither buffers, and the full G-code string (the
// "app froze after an image job / image scan" class, roadmap P1-A).
//
// The driver is the TARGET pixel grid: bounds(mm) x linesPerMm, which can dwarf
// the (import-capped) source image — a 300 x 300 mm fill at 25 lines/mm is
// 7500 x 7500 = 56 million target pixels. Everything downstream
// (resampleLumaNearest, dither's Uint16 + Float32 buffers, emit-raster's string)
// scales with that grid, so bounding the pixel count bounds the freeze.

export const MAX_RASTER_PIXELS = 4_000_000;
export const MAX_RASTER_WORKING_BYTES = 64 * 1024 * 1024;
export const MAX_RASTER_LINES_PER_MM = 25;
export const WARN_RASTER_LINES_PER_MM = 20;

// Bytes the compile holds per TARGET pixel: resampled luma (1, Uint8) + dithered
// S-values (2, Uint16) + Floyd-Steinberg error row/accumulator (4, Float32) + 1
// of margin for transient copies. Conservative on purpose — better to refuse a
// borderline job than to freeze the tab.
const WORKING_BYTES_PER_PIXEL = 8;

export type RasterBudget = {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly pixelCount: number;
  readonly estimatedWorkingBytes: number;
};

export type RasterBudgetVerdict =
  | { readonly kind: 'ok'; readonly budget: RasterBudget }
  | { readonly kind: 'too-large'; readonly budget: RasterBudget; readonly reason: string };

export function rasterBudget(pixelWidth: number, pixelHeight: number): RasterBudget {
  const w = Number.isFinite(pixelWidth) ? Math.max(0, Math.floor(pixelWidth)) : 0;
  const h = Number.isFinite(pixelHeight) ? Math.max(0, Math.floor(pixelHeight)) : 0;
  const pixelCount = w * h;
  return {
    pixelWidth: w,
    pixelHeight: h,
    pixelCount,
    estimatedWorkingBytes: pixelCount * WORKING_BYTES_PER_PIXEL,
  };
}

// Verdict for a target pixel grid. Over the pixel OR working-byte ceiling = a
// job that must be refused before compile (the caller turns this into a
// preflight issue or a live-estimate "too-large").
export function evaluateRasterBudget(pixelWidth: number, pixelHeight: number): RasterBudgetVerdict {
  const budget = rasterBudget(pixelWidth, pixelHeight);
  if (budget.pixelCount <= 0) {
    return { kind: 'too-large', budget, reason: 'invalid raster pixel dimensions' };
  }
  if (budget.pixelCount > MAX_RASTER_PIXELS) {
    return {
      kind: 'too-large',
      budget,
      reason: `${budget.pixelCount} px exceeds the ${MAX_RASTER_PIXELS} px limit`,
    };
  }
  if (budget.estimatedWorkingBytes > MAX_RASTER_WORKING_BYTES) {
    const mb = Math.round(budget.estimatedWorkingBytes / (1024 * 1024));
    return {
      kind: 'too-large',
      budget,
      reason: `~${mb} MB working memory exceeds the ${MAX_RASTER_WORKING_BYTES / (1024 * 1024)} MB limit`,
    };
  }
  return { kind: 'ok', budget };
}
