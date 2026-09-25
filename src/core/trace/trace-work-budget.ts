import type { TraceOptions } from './trace-image';

// Effective working pixels, after supersampling. Edge and Centerline allocate
// several full-frame gradient/distance/skeleton buffers, so their ceiling is
// lower than the binary-contour lane. Native 2048² input still runs; these
// budgets decide only whether an optional 2x/3x working raster is affordable.
export const TRACE_WORKING_PIXEL_BUDGETS = {
  contour: 6_000_000,
  edge: 4_000_000,
  centerline: 4_000_000,
} as const;

export function traceWorkingPixelBudget(options: TraceOptions): number {
  if (options.traceMode === 'edge') return TRACE_WORKING_PIXEL_BUDGETS.edge;
  if (options.traceMode === 'centerline') return TRACE_WORKING_PIXEL_BUDGETS.centerline;
  return TRACE_WORKING_PIXEL_BUDGETS.contour;
}

export function fitsTraceWorkingPixelBudget(
  image: { readonly width: number; readonly height: number },
  factor: number,
  options: TraceOptions,
): boolean {
  if (!Number.isInteger(factor) || factor < 1) return false;
  const workingPixels = image.width * image.height * factor * factor;
  return workingPixels <= traceWorkingPixelBudget(options);
}

// The quality supersample used to switch from 2x straight to native where
// 2x stopped fitting the budget: at the contour budget a 1224² source traced
// on 5.99M pixels and a 1225² one on 1.50M, a 4x step in work between
// neighbouring sizes. The factor now eases down over the last quarter of the
// 2x size range instead: from SUPERSAMPLE_TAPER_START of that size limit to
// the limit itself the squared factor (working pixels per source pixel)
// falls linearly from 4 to TAPER_END_AREA_FACTOR, through fractional
// factors, and only then gives way to native. Sizes below the band keep the
// exact 2x grid and sizes above it stay native. The band ends a little above
// 1x rather than at it: a factor just over 1 only resamples the source with a
// slight blur (measured on the owl scaled to 1220²: IoU 0.812 at 1.03x
// against 0.823 native), so the remaining step to native is kept at 1.2x of
// working pixels, well inside neighbouring-size time budgets.
// Only the outline presets taper. Centerline and Edge Detection read the
// position of 1-px strokes from the working grid, and a fractional grid
// samples them at a different sub-pixel phase on every row: on a 950² page of
// 1-px lines the Centerline of one row drifted 0.81 px off the stroke centre
// with hooked ends, and the Edge Detection outline offset varied 0.95-1.21 px
// between rows (1.12 on every row on the 2x grid). Those two modes keep the
// integer policy and its step at their smaller budget.
export const SUPERSAMPLE_TAPER_START = 0.75;
const TAPER_END_AREA_FACTOR = 1.2;
const TAPERED_FACTOR = 2;

/**
 * The fractional supersample factor for a source inside the taper band just
 * below the largest size a 2x working raster fits, or null outside the band
 * and for Centerline and Edge Detection (the integer policy applies there
 * unchanged).
 */
export function taperedSupersampleFactor(
  image: { readonly width: number; readonly height: number },
  factor: number,
  options: TraceOptions,
): number | null {
  if (factor !== TAPERED_FACTOR) return null;
  if (options.traceMode === 'centerline' || options.traceMode === 'edge') return null;
  const pixels = image.width * image.height;
  const limit = traceWorkingPixelBudget(options) / (TAPERED_FACTOR * TAPERED_FACTOR);
  const start = limit * SUPERSAMPLE_TAPER_START;
  if (!(pixels > start && pixels <= limit)) return null;
  const through = (pixels - start) / (limit - start);
  const fullArea = TAPERED_FACTOR * TAPERED_FACTOR;
  return Math.sqrt(fullArea + (TAPER_END_AREA_FACTOR - fullArea) * through);
}
