// Shared luma-buffer helpers for raster engraving.
//
// Raster import stores one source luma grid, but image-mode output is governed
// by the layer's requested lines/mm. This module resamples the stored source
// to the burn grid compileJob and raster Preview both consume.

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

export function resampleLumaNearest(
  input: LumaRaster,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const width = Math.max(MIN_PIXEL_DIM, Math.floor(targetWidth));
  const height = Math.max(MIN_PIXEL_DIM, Math.floor(targetHeight));
  if (input.width <= 0 || input.height <= 0 || input.luma.length === 0) {
    return whiteLuma(width * height);
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(input.height - 1, Math.floor(((y + 0.5) * input.height) / height));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(input.width - 1, Math.floor(((x + 0.5) * input.width) / width));
      out[y * width + x] = input.luma[srcY * input.width + srcX] ?? WHITE_LUMA;
    }
  }
  return out;
}
