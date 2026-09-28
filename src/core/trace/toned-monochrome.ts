import type { RawImageData } from './trace-image';

// Toned monochrome (ADR-532): sepia, cream-toned and duotone artwork whose
// colour is one weak tint riding on its tones. Such an image carries no
// information beyond its luma, so the colour trigger must not promote it
// onto the local-contrast mask (and the dense-colour working grid) that
// multi-hue and saturated colour art needs.

/** The paper must be paper-light by the colour trigger's own definition: on
 *  cream, shadowed or tinted sheets the local test is what separates strokes
 *  from paper (ADR-401), so those keep the promotion. */
const PAPER_LIGHT_LUMA = 245;
/** Half-width, in luma levels, of the window that finds the paper level. */
const PAPER_WINDOW = 2;
/** A tint is weak while its chroma (channel spread of paper − pixel) stays at
 *  most this fraction of how much darker than the paper the pixel is, plus an
 *  allowance. The sepia hummingbird's tones measure about 0.15; the pale warm
 *  strokes that promotion exists to recover (208, 200, 184 on white) 0.43, a
 *  sepia-brown ink (94, 60, 36) 0.32, the lightest ADR-401 solids (tan, light
 *  blue, pink) 1.0 to 1.5 and saturated inks 1.1 to 2.6. */
const TINT_PER_DARKNESS = 0.2;
const TINT_ALLOWANCE = 6;
/** A weak tint is off the dominant hue when its chroma lies farther from the
 *  hue's half-axis than this allowance plus this fraction of its component
 *  along it (about 19° beyond the allowance). */
const HUE_ALLOWANCE = 6;
const HUE_PER_TINT = 0.35;

type Paper = readonly [number, number, number];
/** A predicate over pixel indices that, when it returns true, has written the
 *  pixel's 3×3 mean colour (edge-clamped, like the trigger) into `mean`. */
export type CountedPixel = (pixel: number, mean: Float64Array) => boolean;
/** How many counted pixels were strong, and the unit-vector sum of the weak
 *  tints' hues in the opponent-chroma plane. */
type WeakHue = { readonly strong: number; readonly x: number; readonly y: number };

/**
 * True when the coherent colour pixels `counts` selects are, relative to
 * paper-light paper, all weak tints of one hue. Streams the counted pixels
 * twice at most and stores nothing per pixel: the first pass finds the
 * dominant hue (stopping once `required` pixels are strong, so saturated
 * colour art pays one pass), the second counts the weak tints off it.
 */
export function isTonedMonochrome(
  image: RawImageData,
  required: number,
  counts: CountedPixel,
): boolean {
  const paper = paperColour(image);
  if (paper === null) return false;
  const hue = weakHue(image, paper, required, counts);
  if (hue === null) return false;
  const length = Math.hypot(hue.x, hue.y);
  if (length === 0) return hue.strong < required;
  const budget = required - hue.strong;
  return offHueCount(image, paper, budget, counts, hue.x / length, hue.y / length) < budget;
}

/** Sums the weak tints' hue directions; null once `required` are strong. */
function weakHue(
  image: RawImageData,
  paper: Paper,
  required: number,
  counts: CountedPixel,
): WeakHue | null {
  const pixelCount = image.width * image.height;
  const mean = new Float64Array(3);
  const tint = new Float64Array(3);
  let strong = 0;
  let x = 0;
  let y = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!counts(pixel, mean)) continue;
    tintOf(mean, paper, tint);
    if (isStrongTint(tint)) {
      strong += 1;
      if (strong >= required) return null;
      continue;
    }
    const a = chromaA(tint);
    const b = chromaB(tint);
    const magnitude = Math.hypot(a, b);
    if (magnitude === 0) continue;
    x += a / magnitude;
    y += b / magnitude;
  }
  return { strong, x, y };
}

/** Weak tints off the hue (ux, uy); stops counting at `budget`. */
function offHueCount(
  image: RawImageData,
  paper: Paper,
  budget: number,
  counts: CountedPixel,
  ux: number,
  uy: number,
): number {
  const pixelCount = image.width * image.height;
  const mean = new Float64Array(3);
  const tint = new Float64Array(3);
  let off = 0;
  for (let pixel = 0; pixel < pixelCount && off < budget; pixel += 1) {
    if (!counts(pixel, mean)) continue;
    tintOf(mean, paper, tint);
    if (isStrongTint(tint)) continue;
    const a = chromaA(tint);
    const b = chromaB(tint);
    const along = a * ux + b * uy;
    const across = Math.abs(a * uy - b * ux);
    // Distance from the hue's half-axis: the opposite hue is another hue.
    const distance = along >= 0 ? across : Math.hypot(along, across);
    if (distance > HUE_ALLOWANCE + HUE_PER_TINT * Math.max(0, along)) off += 1;
  }
  return off;
}

/** Mean colour of the pixels at the most populated luma level (5-level
 *  window), or null when that colour is not paper-light. The window's level
 *  leans up to two levels brighter than a uniform paper, so the gate reads
 *  the mean colour's own luma. */
function paperColour(image: RawImageData): Paper | null {
  const level = paperLevel(lumaHistogram(image));
  if (level < PAPER_LIGHT_LUMA) return null;
  const paper = meanColourNearLevel(image, level);
  return lumaByte(paper[0], paper[1], paper[2]) < PAPER_LIGHT_LUMA ? null : paper;
}

function lumaHistogram(image: RawImageData): Float64Array {
  const pixelCount = image.width * image.height;
  const histogram = new Float64Array(256);
  const rgb = new Float64Array(3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    readRgb(image, pixel, rgb);
    const l = lumaByte(rgb[0] as number, rgb[1] as number, rgb[2] as number);
    histogram[l] = (histogram[l] as number) + 1;
  }
  return histogram;
}

/** The level whose window holds the most pixels; ties go to the brighter. */
function paperLevel(histogram: Float64Array): number {
  let level = -1;
  let best = -1;
  for (let l = 0; l < 256; l += 1) {
    let sum = 0;
    for (let k = Math.max(0, l - PAPER_WINDOW); k <= Math.min(255, l + PAPER_WINDOW); k += 1)
      sum += histogram[k] as number;
    if (sum >= best) {
      best = sum;
      level = l;
    }
  }
  return level;
}

function meanColourNearLevel(image: RawImageData, level: number): Paper {
  const pixelCount = image.width * image.height;
  const rgb = new Float64Array(3);
  const sum = [0, 0, 0];
  let n = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    readRgb(image, pixel, rgb);
    const l = lumaByte(rgb[0] as number, rgb[1] as number, rgb[2] as number);
    if (Math.abs(l - level) > PAPER_WINDOW) continue;
    for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] as number) + (rgb[c] as number);
    n += 1;
  }
  return [(sum[0] as number) / n, (sum[1] as number) / n, (sum[2] as number) / n];
}

function readRgb(image: RawImageData, pixel: number, out: Float64Array): void {
  const o = pixel * 4;
  out[0] = image.data[o] ?? 255;
  out[1] = image.data[o + 1] ?? 255;
  out[2] = image.data[o + 2] ?? 255;
}

/** Paper minus the pixel's 3×3 mean colour. */
function tintOf(mean: Float64Array, paper: Paper, out: Float64Array): void {
  out[0] = paper[0] - (mean[0] as number);
  out[1] = paper[1] - (mean[1] as number);
  out[2] = paper[2] - (mean[2] as number);
}

function isStrongTint(tint: Float64Array): boolean {
  const r = tint[0] as number;
  const g = tint[1] as number;
  const b = tint[2] as number;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const darkness = Math.max(0, 0.299 * r + 0.587 * g + 0.114 * b);
  return chroma > TINT_PER_DARKNESS * darkness + TINT_ALLOWANCE;
}

/** Orthonormal opponent-chroma coordinates of an RGB difference. */
function chromaA(tint: Float64Array): number {
  return ((tint[0] as number) - (tint[1] as number)) / Math.SQRT2;
}

function chromaB(tint: Float64Array): number {
  return ((tint[0] as number) + (tint[1] as number) - 2 * (tint[2] as number)) / Math.sqrt(6);
}

function lumaByte(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}
