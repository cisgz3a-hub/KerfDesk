import { MAX_RASTER_LINES_PER_MM } from './raster-budget';
import { compiledLinesPerMm } from './luma-resample';

export const MM_PER_INCH = 25.4;
export const MIN_RASTER_LINES_PER_MM = 5;

export function normalizeLinesPerMm(value: number): number {
  const finite = Number.isFinite(value) ? value : MIN_RASTER_LINES_PER_MM;
  const clamped = Math.max(MIN_RASTER_LINES_PER_MM, Math.min(MAX_RASTER_LINES_PER_MM, finite));
  return Number(clamped.toFixed(6));
}

/**
 * Line interval in mm for a stored density — the interval the COMPILER will
 * burn, not the interval the recommended range would prefer.
 *
 * normalizeLinesPerMm is the RECOMMENDED range and belongs on input bounds.
 * Resolving a display through it made the layers panel disagree with both the
 * emitted program and Job Review for any stored value outside that range (a
 * .lbrn import at a 0.5 mm interval stores 2 lines/mm and burned 2.5x coarser
 * than the panel showed). Displays resolve through the compiler's own floor.
 */
export function linesPerMmToLineIntervalMm(linesPerMm: number): number {
  return 1 / compiledLinesPerMm(linesPerMm);
}

export function lineIntervalMmToLinesPerMm(intervalMm: number): number {
  const finite = Number.isFinite(intervalMm) ? intervalMm : 0;
  return normalizeLinesPerMm(1 / Math.max(Number.EPSILON, finite));
}

export function linesPerMmToDpi(linesPerMm: number): number {
  return normalizeLinesPerMm(linesPerMm) * MM_PER_INCH;
}

export function dpiToLinesPerMm(dpi: number): number {
  const finite = Number.isFinite(dpi) ? dpi : 0;
  return normalizeLinesPerMm(finite / MM_PER_INCH);
}
