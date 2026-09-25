import type { RawImageData } from './trace-image';

export type AutoSketchTraceOptions = {
  readonly sketchTrace?: boolean;
  readonly autoSketchTrace?: boolean;
};

export function shouldUseSketchTrace(
  image: RawImageData,
  options: AutoSketchTraceOptions,
): boolean {
  if (options.sketchTrace === true) return true;
  if (options.autoSketchTrace !== true) return false;
  return hasEnoughColourForAutoSketch(image);
}

/** A pixel is chromatic when its channel spread reaches this and it is not paper-light. */
const MIN_PIXEL_SPREAD = 12;
const MAX_COLOUR_LUMA = 245;
/** Spread the pixel's 3×3 neighbourhood mean must keep. Averaging nine
 *  independent samples divides per-channel noise by three, so ±8 sensor or
 *  synthetic noise on grey art (spread ≥ 12 in ~16% of pixels) cannot reach
 *  it, while a coloured patch or stroke keeps its spread (a 1 px line on
 *  paper keeps a third of it). */
const MIN_NEIGHBOURHOOD_SPREAD = 8;

// Colour promotes only when it is spatially coherent (ADR-393): each counted
// pixel must be chromatic itself and sit in a chromatic 3×3 neighbourhood.
function hasEnoughColourForAutoSketch(image: RawImageData): boolean {
  const pixelCount = image.width * image.height;
  if (pixelCount === 0) return false;
  let colourPixels = 0;
  const required = Math.max(32, Math.ceil(pixelCount * 0.002));
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const r = image.data[offset] ?? 255;
    const g = image.data[offset + 1] ?? 255;
    const b = image.data[offset + 2] ?? 255;
    if (!isChromatic(r, g, b, MIN_PIXEL_SPREAD)) continue;
    if (!chromaticNeighbourhood(image, pixel)) continue;
    colourPixels += 1;
    if (colourPixels >= required) return true;
  }
  return false;
}

function isChromatic(r: number, g: number, b: number, minSpread: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) >= minSpread && lumaByte(r, g, b) < MAX_COLOUR_LUMA;
}

/** Whether the mean colour of the 3×3 window (edge-clamped, like the
 *  local-contrast blur) is itself chromatic. */
function chromaticNeighbourhood(image: RawImageData, pixel: number): boolean {
  const { width, height, data } = image;
  const x = pixel % width;
  const y = (pixel - x) / width;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    const yy = Math.min(height - 1, Math.max(0, y + dy));
    for (let dx = -1; dx <= 1; dx += 1) {
      const offset = (yy * width + Math.min(width - 1, Math.max(0, x + dx))) * 4;
      r += data[offset] ?? 255;
      g += data[offset + 1] ?? 255;
      b += data[offset + 2] ?? 255;
    }
  }
  return isChromatic(r / 9, g / 9, b / 9, MIN_NEIGHBOURHOOD_SPREAD);
}

function lumaByte(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}
