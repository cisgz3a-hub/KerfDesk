// Quick checks of a live camera picture before calibration (ADR-663): is it
// bright enough, is part of it washed out, and at best how much of the bed one
// pixel covers. Advice for the setup wizard only; nothing is refused on it.
// Pure core: an RGBA frame and the bed size in, plain numbers out.

import type { RgbaImage } from './rgba-image';

export type PictureBrightness = 'dark' | 'ok' | 'washed-out';

export type PictureQuality = {
  /** Average Rec. 601 luma of the sampled pixels, 0..255. */
  readonly meanLuma: number;
  /** Share of sampled pixels at or near white, 0..1. */
  readonly washedOutFraction: number;
  readonly brightness: PictureBrightness;
  /**
   * Bed millimetres per picture pixel if the bed filled the picture: a lower
   * bound, since a camera that sees past the bed spends pixels outside it.
   */
  readonly bestMmPerPixel: number | null;
};

// Below this average the rings are dim enough that a light helps.
export const DARK_MEAN_LUMA = 60;
// Pixels this bright have lost their detail (clipped highlights or glare).
export const WASHED_OUT_LUMA = 250;
// More than this share washed out and rings there can be lost.
export const WASHED_OUT_SHARE = 0.05;
// Above this each pixel spans enough of the bed to limit placement by eye.
export const COARSE_MM_PER_PIXEL = 0.5;

// Enough samples for a stable average on any frame, cheap on a 4K one.
const MAX_SAMPLES = 40_000;

/** How the picture measures; null for an empty frame. */
export function assessPicture(
  image: RgbaImage,
  bed: { readonly widthMm: number; readonly heightMm: number },
): PictureQuality | null {
  const { width, height, data } = image;
  if (width <= 0 || height <= 0) return null;
  const stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / MAX_SAMPLES)));
  let sum = 0;
  let washedOut = 0;
  let count = 0;
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      const luma =
        0.299 * (data[offset] ?? 0) +
        0.587 * (data[offset + 1] ?? 0) +
        0.114 * (data[offset + 2] ?? 0);
      sum += luma;
      if (luma >= WASHED_OUT_LUMA) washedOut += 1;
      count += 1;
    }
  }
  const meanLuma = sum / count;
  const washedOutFraction = washedOut / count;
  return {
    meanLuma,
    washedOutFraction,
    brightness: brightnessOf(meanLuma, washedOutFraction),
    bestMmPerPixel: bestMmPerPixel(width, height, bed.widthMm, bed.heightMm),
  };
}

function brightnessOf(meanLuma: number, washedOutFraction: number): PictureBrightness {
  if (washedOutFraction > WASHED_OUT_SHARE) return 'washed-out';
  return meanLuma < DARK_MEAN_LUMA ? 'dark' : 'ok';
}

// The bed's long side across the picture's long side, the most pixels the bed
// can get when the camera frames it edge to edge.
function bestMmPerPixel(
  widthPx: number,
  heightPx: number,
  bedWidthMm: number,
  bedHeightMm: number,
): number | null {
  if (!(bedWidthMm > 0) || !(bedHeightMm > 0)) return null;
  const longPx = Math.max(widthPx, heightPx);
  const shortPx = Math.min(widthPx, heightPx);
  const longMm = Math.max(bedWidthMm, bedHeightMm);
  const shortMm = Math.min(bedWidthMm, bedHeightMm);
  return Math.max(longMm / longPx, shortMm / shortPx);
}
