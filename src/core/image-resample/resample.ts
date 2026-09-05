// Resample the entire source domain: area coverage on each shrinking axis,
// pixel-centre linear interpolation on each enlarging axis. Intermediate
// colors stay premultiplied and unrounded so transparent RGB cannot bleed.
// A two-row cache bounds temporary pixel storage independently of image height.

import { RGBA_CHANNELS, type RgbaBuffer } from '../image-edit';
import { axisContributions, type AxisTap } from './resample-axis';

const MAX_BYTE = 255;
const ROW_CACHE_SIZE = 2;

/** Resample to exactly width x height (floored, min 1 px), sharing no bytes. */
export function resampleBuffer(source: RgbaBuffer, width: number, height: number): RgbaBuffer {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (w === source.width && h === source.height) {
    return { width: w, height: h, data: new Uint8ClampedArray(source.data) };
  }
  const horizontal = axisContributions(source.width, w);
  const vertical = axisContributions(source.height, h);
  const rows = new Map<number, Float64Array>();
  const data = new Uint8ClampedArray(w * h * RGBA_CHANNELS);
  const accumulated = new Float64Array(w * RGBA_CHANNELS);
  for (let y = 0; y < h; y += 1) {
    accumulated.fill(0);
    for (const tap of vertical[y] ?? []) {
      const row = cachedRow(source, tap.index, horizontal, rows);
      for (let i = 0; i < accumulated.length; i += 1) {
        accumulated[i] = (accumulated[i] ?? 0) + (row[i] ?? 0) * tap.weight;
      }
    }
    writeRow(data, y * w * RGBA_CHANNELS, accumulated);
  }
  return { width: w, height: h, data };
}

function cachedRow(
  source: RgbaBuffer,
  y: number,
  contributions: readonly (readonly AxisTap[])[],
  cache: Map<number, Float64Array>,
): Float64Array {
  const existing = cache.get(y);
  if (existing !== undefined) return existing;
  let reusable: Float64Array | undefined;
  if (cache.size >= ROW_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      reusable = cache.get(oldest);
      cache.delete(oldest);
    }
  }
  const row = horizontalRow(source, y, contributions, reusable);
  cache.set(y, row);
  return row;
}

function horizontalRow(
  source: RgbaBuffer,
  y: number,
  contributions: readonly (readonly AxisTap[])[],
  reusable?: Float64Array,
): Float64Array {
  const row = reusable ?? new Float64Array(contributions.length * RGBA_CHANNELS);
  row.fill(0);
  contributions.forEach((taps, x) => {
    const out = x * RGBA_CHANNELS;
    for (const tap of taps) {
      const src = (y * source.width + tap.index) * RGBA_CHANNELS;
      const alphaWeight = ((source.data[src + 3] ?? 0) / MAX_BYTE) * tap.weight;
      for (let channel = 0; channel < 3; channel += 1) {
        row[out + channel] =
          (row[out + channel] ?? 0) + (source.data[src + channel] ?? 0) * alphaWeight;
      }
      row[out + 3] = (row[out + 3] ?? 0) + alphaWeight;
    }
  });
  return row;
}

function writeRow(destination: Uint8ClampedArray, offset: number, row: Float64Array): void {
  for (let base = 0; base < row.length; base += RGBA_CHANNELS) {
    const alpha = row[base + 3] ?? 0;
    if (alpha <= 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      destination[offset + base + channel] = Math.round((row[base + channel] ?? 0) / alpha);
    }
    destination[offset + base + 3] = Math.round(alpha * MAX_BYTE);
  }
}
