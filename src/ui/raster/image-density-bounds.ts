// Line Interval and DPI field bounds for an image's scan density, shared by
// Cut Settings and Adjust Image (C-6). New entries keep the recommended range:
// each dialog clamps into it. A stored density outside that range (a LightBurn
// recipe at a 0.5 mm interval stores 2 lines/mm) still burns as stored, so the
// bounds also admit its shown value, or the browser's range check would block
// Apply for an unrelated edit.

import {
  linesPerMmToDpi,
  linesPerMmToLineIntervalMm,
  MAX_RASTER_LINES_PER_MM,
  MIN_RASTER_LINES_PER_MM,
} from '../../core/raster';

export type NumberBounds = { readonly min: number; readonly max: number };

export type ImageDensityBounds = {
  readonly intervalMm: NumberBounds;
  readonly dpi: NumberBounds;
};

export function imageDensityBounds(storedLinesPerMm: number): ImageDensityBounds {
  // Rounded as the fields show them, so the shown stored value is in range.
  const storedIntervalMm = roundTo(linesPerMmToLineIntervalMm(storedLinesPerMm), 4);
  const storedDpi = roundTo(linesPerMmToDpi(storedLinesPerMm), 2);
  return {
    intervalMm: {
      min: Math.min(linesPerMmToLineIntervalMm(MAX_RASTER_LINES_PER_MM), storedIntervalMm),
      max: Math.max(linesPerMmToLineIntervalMm(MIN_RASTER_LINES_PER_MM), storedIntervalMm),
    },
    dpi: {
      min: Math.min(linesPerMmToDpi(MIN_RASTER_LINES_PER_MM), storedDpi),
      max: Math.max(linesPerMmToDpi(MAX_RASTER_LINES_PER_MM), storedDpi),
    },
  };
}

function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}
