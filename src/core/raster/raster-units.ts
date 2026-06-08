import { MAX_RASTER_LINES_PER_MM } from './raster-budget';

export const MM_PER_INCH = 25.4;
export const MIN_RASTER_LINES_PER_MM = 5;

export function normalizeLinesPerMm(value: number): number {
  const finite = Number.isFinite(value) ? value : MIN_RASTER_LINES_PER_MM;
  const clamped = Math.max(MIN_RASTER_LINES_PER_MM, Math.min(MAX_RASTER_LINES_PER_MM, finite));
  return Number(clamped.toFixed(6));
}

export function linesPerMmToLineIntervalMm(linesPerMm: number): number {
  return 1 / normalizeLinesPerMm(linesPerMm);
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
