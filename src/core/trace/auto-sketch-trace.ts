import type { RawImageData } from './trace-image';

export type AutoSketchTraceOptions = {
  readonly sketchTrace?: boolean;
  readonly autoSketchTrace?: boolean;
  readonly sourceAutoSketch?: boolean;
};

export function shouldUseSketchTrace(
  image: RawImageData,
  options: AutoSketchTraceOptions,
): boolean {
  if (options.sketchTrace === true) return true;
  if (options.autoSketchTrace !== true) return false;
  // A derived region (Enhance crop) inherits the full source's verdict: the
  // colour-pixel floor is a count, so a crop, and its 4x-pixel supersample,
  // can cross it where the whole image did not (ADR-410).
  return options.sourceAutoSketch ?? hasEnoughColourForAutoSketch(image);
}

/** The auto-sketch verdict on exactly this image, ignoring any carried one. */
export function sourceHasAutoSketchColour(image: RawImageData): boolean {
  return hasEnoughColourForAutoSketch(image);
}

/** A pixel is chromatic when its channel spread reaches this and it is not paper-light. */
const MIN_PIXEL_SPREAD = 12;
const MAX_COLOUR_LUMA = 245;
/** Least spread the pixel's 3×3 neighbourhood mean must keep. A coloured
 *  patch or stroke keeps its spread there (a 1 px line on paper a third). */
const MIN_NEIGHBOURHOOD_SPREAD = 8;
/** On noisy images the neighbourhood spread must also exceed this many
 *  standard deviations of the 3×3 mean's per-channel noise (σ/3): the spread
 *  of three independent channel means passes 6 of their deviations in fewer
 *  than 1 in 10,000 pixels, far below the promotion count. */
const NOISE_DEVIATIONS = 6;
/** A neighbour difference of a channel difference (r − g, g − b) carries
 *  four noise terms, sd 2σ; the median of its magnitude is 0.6745 · 2σ. */
const MEDIAN_ABS_CHROMA_DIFFERENCE_PER_SIGMA = 0.6745 * 2;

// Colour promotes only when it is spatially coherent (ADR-393): each counted
// pixel must be chromatic itself and sit in a 3×3 neighbourhood whose MEAN
// colour is chromatic beyond what the image's own per-channel noise explains.
function hasEnoughColourForAutoSketch(image: RawImageData): boolean {
  const pixelCount = image.width * image.height;
  if (pixelCount === 0) return false;
  const minSpread = Math.max(
    MIN_NEIGHBOURHOOD_SPREAD,
    (NOISE_DEVIATIONS * channelNoiseSigma(image)) / 3,
  );
  let colourPixels = 0;
  const required = Math.max(32, Math.ceil(pixelCount * 0.002));
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const r = image.data[offset] ?? 255;
    const g = image.data[offset + 1] ?? 255;
    const b = image.data[offset + 2] ?? 255;
    if (!isChromatic(r, g, b, MIN_PIXEL_SPREAD)) continue;
    if (!chromaticNeighbourhood(image, pixel, minSpread)) continue;
    colourPixels += 1;
    if (colourPixels >= required) return true;
  }
  return false;
}

/** Robust per-channel CHROMA noise estimate over the artwork. For neighbour
 *  pairs that are not both paper-light, the differences of r − g and of
 *  g − b between horizontal neighbours are collected; with independent
 *  per-channel noise σ each has sd 2σ, so σ = median |difference| ÷
 *  (0.6745 · 2). Grey texture and hatching move all channels together and
 *  colour edges are sparse, so neither raises the estimate; clean art reads
 *  0, and clean margins around a noisy picture do not hide its noise. */
function channelNoiseSigma(image: RawImageData): number {
  const { width, height, data } = image;
  const histogram = new Uint32Array(511);
  let samples = 0;
  const at = (offset: number, c: number): number => data[offset + c] ?? 255;
  const paperLight = (o: number): boolean =>
    lumaByte(at(o, 0), at(o, 1), at(o, 2)) >= MAX_COLOUR_LUMA;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x + 1 < width; x += 1) {
      const o = (y * width + x) * 4;
      if (paperLight(o) && paperLight(o + 4)) continue;
      for (let c = 0; c < 2; c += 1) {
        const d = Math.abs(at(o, c) - at(o, c + 1) - (at(o + 4, c) - at(o + 4, c + 1)));
        histogram[d] = (histogram[d] as number) + 1;
      }
      samples += 2;
    }
  }
  let seen = 0;
  for (let d = 0; d < histogram.length; d += 1) {
    seen += histogram[d] as number;
    if (seen * 2 >= samples) return d / MEDIAN_ABS_CHROMA_DIFFERENCE_PER_SIGMA;
  }
  return 0;
}

function isChromatic(r: number, g: number, b: number, minSpread: number): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) >= minSpread && lumaByte(r, g, b) < MAX_COLOUR_LUMA;
}

/** Whether the mean colour of the 3×3 window (edge-clamped, like the
 *  local-contrast blur) is itself chromatic with at least `minSpread`. */
function chromaticNeighbourhood(image: RawImageData, pixel: number, minSpread: number): boolean {
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
  return isChromatic(r / 9, g / 9, b / 9, minSpread);
}

function lumaByte(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}
