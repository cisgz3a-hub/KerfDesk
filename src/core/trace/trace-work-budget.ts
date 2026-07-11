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
