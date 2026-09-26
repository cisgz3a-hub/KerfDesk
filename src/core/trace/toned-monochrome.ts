import type { RawImageData } from './trace-image';

// Toned monochrome (ADR-446): sepia, cream-toned and duotone artwork whose
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
/** The weak tints in the opponent-chroma plane (x, y interleaved) and how
 *  many counted pixels were strong. */
type WeakTints = { readonly strong: number; readonly chroma: readonly number[] };

/**
 * True when the coherent colour pixels `counts` selects are, relative to
 * paper-light paper, all weak tints of one hue. Stops as soon as `required`
 * pixels are strong, so saturated colour art pays at most one pass.
 */
export function isTonedMonochrome(
  image: RawImageData,
  required: number,
  counts: (pixel: number) => boolean,
): boolean {
  const paper = paperColour(image);
  if (paper === null) return false;
  const weak = weakTints(image, paper, required, counts);
  return weak !== null && weak.strong + offHueCount(weak.chroma) < required;
}

/** Collects the weak tints; null once `required` counted pixels are strong. */
function weakTints(
  image: RawImageData,
  paper: Paper,
  required: number,
  counts: (pixel: number) => boolean,
): WeakTints | null {
  const pixelCount = image.width * image.height;
  const tint = new Float64Array(3);
  const chroma: number[] = [];
  let strong = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!counts(pixel)) continue;
    tintAt(image, pixel, paper, tint);
    if (!isStrongTint(tint)) {
      chroma.push(...chromaPlane(tint));
      continue;
    }
    strong += 1;
    if (strong >= required) return null;
  }
  return { strong, chroma };
}

/** Weak tints off their dominant hue: the unit-vector sum of all of them. */
function offHueCount(chroma: readonly number[]): number {
  let hueX = 0;
  let hueY = 0;
  for (let i = 0; i < chroma.length; i += 2) {
    const a = chroma[i] as number;
    const b = chroma[i + 1] as number;
    const magnitude = Math.hypot(a, b);
    if (magnitude === 0) continue;
    hueX += a / magnitude;
    hueY += b / magnitude;
  }
  const length = Math.hypot(hueX, hueY);
  if (length === 0) return 0;
  const ux = hueX / length;
  const uy = hueY / length;
  let off = 0;
  for (let i = 0; i < chroma.length; i += 2) {
    const a = chroma[i] as number;
    const b = chroma[i + 1] as number;
    const along = a * ux + b * uy;
    const across = Math.abs(a * uy - b * ux);
    // Distance from the hue's half-axis: the opposite hue is another hue.
    const distance = along >= 0 ? across : Math.hypot(along, across);
    if (distance > HUE_ALLOWANCE + HUE_PER_TINT * Math.max(0, along)) off += 1;
  }
  return off;
}

/** Mean colour of the pixels at the most populated luma level (5-level
 *  window), or null when that level is not paper-light. */
function paperColour(image: RawImageData): Paper | null {
  const level = paperLevel(lumaHistogram(image));
  return level < PAPER_LIGHT_LUMA ? null : meanColourNearLevel(image, level);
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

/** Paper minus the pixel's 3×3 mean colour (edge-clamped, like the trigger). */
function tintAt(image: RawImageData, pixel: number, paper: Paper, out: Float64Array): void {
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
  out[0] = paper[0] - r / 9;
  out[1] = paper[1] - g / 9;
  out[2] = paper[2] - b / 9;
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
function chromaPlane(tint: Float64Array): readonly [number, number] {
  const r = tint[0] as number;
  const g = tint[1] as number;
  const b = tint[2] as number;
  return [(r - g) / Math.SQRT2, (r + g - 2 * b) / Math.sqrt(6)];
}

function lumaByte(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}
