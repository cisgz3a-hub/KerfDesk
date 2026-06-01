// Shared luma-buffer helpers for raster engraving.
//
// Raster import stores one source luma grid, but image-mode output is governed
// by the layer's requested lines/mm. This module resamples the stored source
// to the burn grid compileJob and raster Preview both consume.

const WHITE_LUMA = 255;
const MIN_PIXEL_DIM = 1;

export type LumaRaster = {
  readonly luma: Uint8Array;
  readonly width: number;
  readonly height: number;
};

export function pixelExtentForMm(mm: number, linesPerMm: number): number {
  const px = Math.round(Math.max(0, mm) * Math.max(MIN_PIXEL_DIM, linesPerMm));
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
