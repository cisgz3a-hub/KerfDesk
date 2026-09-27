// Which bed pixels belong to a piece (ADR-442). The picture is split in two by
// Otsu's threshold on one feature per pixel: the colour distance to a
// reference point when there is one (the design's centre, usually on a
// blank), so colour tells blanks from the bed even when their brightness
// matches, and brightness otherwise. The side that owns less of the
// picture's edge is the pieces, because the bed surrounds them; that holds
// whether the reference sits on a blank or on the bed. Pure core.

import type { PieceImage } from './piece-image';

export type PieceMask = {
  readonly width: number;
  readonly height: number;
  /** 1 on a piece. */
  readonly on: Uint8Array;
  /** The value each pixel was split by, and where the split is, for finding edges between pixels. */
  readonly feature: Float32Array;
  readonly threshold: number;
};

export type PixelPoint = { readonly x: number; readonly y: number };

const HISTOGRAM_BINS = 256;
// Colour of the reference: the mean over this many pixels either side of it.
const REFERENCE_RADIUS_PX = 3;

export function pieceMask(image: PieceImage, reference: PixelPoint | null): PieceMask {
  const colour = reference === null ? null : meanColour(image, reference);
  const feature = colour === null ? lumaFeature(image) : distanceFeature(image, colour);
  const threshold = otsuThreshold(feature, image.visible);
  const on = new Uint8Array(image.width * image.height);
  const low = lowSideIsPieces(image, feature, threshold);
  for (let i = 0; i < on.length; i += 1) {
    if (image.visible[i] !== 1) continue;
    const value = feature[i] ?? 0;
    on[i] = (low ? value <= threshold : value > threshold) ? 1 : 0;
  }
  return { width: image.width, height: image.height, on, feature, threshold };
}

function lumaFeature(image: PieceImage): Float32Array {
  const out = new Float32Array(image.width * image.height);
  for (let i = 0; i < out.length; i += 1) {
    const r = image.rgb[i * 3] ?? 0;
    const g = image.rgb[i * 3 + 1] ?? 0;
    const b = image.rgb[i * 3 + 2] ?? 0;
    out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

function distanceFeature(image: PieceImage, colour: readonly number[]): Float32Array {
  const out = new Float32Array(image.width * image.height);
  for (let i = 0; i < out.length; i += 1) {
    const dr = (image.rgb[i * 3] ?? 0) - (colour[0] ?? 0);
    const dg = (image.rgb[i * 3 + 1] ?? 0) - (colour[1] ?? 0);
    const db = (image.rgb[i * 3 + 2] ?? 0) - (colour[2] ?? 0);
    out[i] = Math.hypot(dr, dg, db);
  }
  return out;
}

/** Mean blurred colour around `at`, or null where the camera saw none of it. */
function meanColour(image: PieceImage, at: PixelPoint): readonly number[] | null {
  const sum = [0, 0, 0];
  let count = 0;
  const cx = Math.round(at.x);
  const cy = Math.round(at.y);
  for (let y = cy - REFERENCE_RADIUS_PX; y <= cy + REFERENCE_RADIUS_PX; y += 1) {
    for (let x = cx - REFERENCE_RADIUS_PX; x <= cx + REFERENCE_RADIUS_PX; x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const i = y * image.width + x;
      if (image.visible[i] !== 1) continue;
      for (let c = 0; c < 3; c += 1) sum[c] = (sum[c] ?? 0) + (image.rgb[i * 3 + c] ?? 0);
      count += 1;
    }
  }
  return count === 0 ? null : sum.map((value) => value / count);
}

/** Where the visible pixels' feature values split in two (Otsu, then the midpoint of the sides' means). */
export function otsuThreshold(feature: Float32Array, visible: Uint8Array): number {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < feature.length; i += 1) {
    if (visible[i] !== 1) continue;
    const value = feature[i] ?? 0;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!(max > min)) return max;
  const scale = (HISTOGRAM_BINS - 1) / (max - min);
  const histogram = new Float64Array(HISTOGRAM_BINS);
  let total = 0;
  for (let i = 0; i < feature.length; i += 1) {
    if (visible[i] !== 1) continue;
    const bin = Math.round(((feature[i] ?? 0) - min) * scale);
    histogram[bin] = (histogram[bin] ?? 0) + 1;
    total += 1;
  }
  const split = min + (otsuBin(histogram, total) + 0.5) / scale;
  return midpointOfMeans(feature, visible, split);
}

// Otsu's split leans toward the larger side; halfway between the two sides'
// means puts a blurred straight edge back where it really is.
function midpointOfMeans(feature: Float32Array, visible: Uint8Array, split: number): number {
  let lowSum = 0;
  let lowCount = 0;
  let highSum = 0;
  let highCount = 0;
  for (let i = 0; i < feature.length; i += 1) {
    if (visible[i] !== 1) continue;
    const value = feature[i] ?? 0;
    if (value <= split) {
      lowSum += value;
      lowCount += 1;
    } else {
      highSum += value;
      highCount += 1;
    }
  }
  if (lowCount === 0 || highCount === 0) return split;
  return (lowSum / lowCount + highSum / highCount) / 2;
}

function otsuBin(histogram: Float64Array, total: number): number {
  let sumAll = 0;
  for (let b = 0; b < histogram.length; b += 1) sumAll += b * (histogram[b] ?? 0);
  let weightLow = 0;
  let sumLow = 0;
  let best = 0;
  let bestVariance = -1;
  for (let b = 0; b < histogram.length; b += 1) {
    weightLow += histogram[b] ?? 0;
    if (weightLow === 0) continue;
    const weightHigh = total - weightLow;
    if (weightHigh === 0) break;
    sumLow += b * (histogram[b] ?? 0);
    const meanLow = sumLow / weightLow;
    const meanHigh = (sumAll - sumLow) / weightHigh;
    const variance = weightLow * weightHigh * (meanLow - meanHigh) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = b;
    }
  }
  return best;
}

// Edge pixels are visible pixels on the picture's border or next to an
// unseen one. The side that owns fewer of them is the pieces.
function lowSideIsPieces(image: PieceImage, feature: Float32Array, threshold: number): boolean {
  let low = 0;
  let high = 0;
  const { width, height, visible } = image;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (visible[i] !== 1 || !isEdge(visible, width, height, x, y)) continue;
      if ((feature[i] ?? 0) <= threshold) low += 1;
      else high += 1;
    }
  }
  return low < high;
}

function isEdge(visible: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  if (x === 0 || y === 0 || x === width - 1 || y === height - 1) return true;
  const i = y * width + x;
  return (
    visible[i - 1] !== 1 ||
    visible[i + 1] !== 1 ||
    visible[i - width] !== 1 ||
    visible[i + width] !== 1
  );
}
