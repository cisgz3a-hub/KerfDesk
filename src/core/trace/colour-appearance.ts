// Colour layers trace visible sRGB over white, with alpha=0 remaining void.
// The decoder already composites RGB and tags it; straight RGBA needs exactly
// one composite. Normalize before averaging so alpha is never applied twice.
// Large images read this appearance on demand into a bounded two-row cache,
// avoiding an additional full-source RGBA allocation before the working cap.

import { axisContributions, type AxisTap } from '../image-resample/resample-axis';
import type { RawImageData } from './trace-image';

const CHANNELS = 4;
const MAX_BYTE = 255;

/** Native-resolution appearance; opaque/void-only inputs need no new buffer. */
export function colourAppearance(source: RawImageData): RawImageData {
  let data: Uint8ClampedArray | undefined;
  for (let offset = 0; offset < source.data.length; offset += CHANNELS) {
    const alpha = source.data[offset + 3] as number;
    if (alpha === 0 || alpha === MAX_BYTE) continue;
    data ??= source.data.slice();
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = visibleChannel(source, offset, channel, alpha);
    }
    data[offset + 3] = MAX_BYTE;
  }
  return data === undefined ? source : { ...source, data, rgbCompositedOnWhite: true };
}

/** Area-resample visible colour, keeping entirely transparent cells void. */
export function resampleColourAppearance(
  source: RawImageData,
  width: number,
  height: number,
): RawImageData {
  const horizontal = axisContributions(source.width, width);
  const vertical = axisContributions(source.height, height);
  const rows = new Map<number, Float64Array>();
  const data = new Uint8ClampedArray(width * height * CHANNELS);
  const accumulated = new Float64Array(width * CHANNELS);
  for (let y = 0; y < height; y += 1) {
    accumulated.fill(0);
    for (const tap of vertical[y] ?? []) {
      const row = cachedRow(source, tap.index, horizontal, rows);
      for (let i = 0; i < accumulated.length; i += 1) {
        accumulated[i] = (accumulated[i] as number) + (row[i] as number) * tap.weight;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const cell = x * CHANNELS;
      const visible = accumulated[cell + 3] as number;
      if (visible <= 0) continue;
      const out = (y * width + x) * CHANNELS;
      for (let channel = 0; channel < 3; channel += 1) {
        data[out + channel] = Math.round(accumulated[cell + channel] as number);
      }
      data[out + 3] = MAX_BYTE;
    }
  }
  return { width, height, data, rgbCompositedOnWhite: true };
}

function cachedRow(
  source: RawImageData,
  y: number,
  contributions: readonly (readonly AxisTap[])[],
  cache: Map<number, Float64Array>,
): Float64Array {
  const existing = cache.get(y);
  if (existing !== undefined) return existing;
  let row: Float64Array | undefined;
  if (cache.size >= 2) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      row = cache.get(oldest);
      cache.delete(oldest);
    }
  }
  row ??= new Float64Array(contributions.length * CHANNELS);
  horizontalRow(source, y, contributions, row);
  cache.set(y, row);
  return row;
}

function horizontalRow(
  source: RawImageData,
  y: number,
  contributions: readonly (readonly AxisTap[])[],
  row: Float64Array,
): void {
  row.fill(0);
  contributions.forEach((taps, x) => {
    const out = x * CHANNELS;
    for (const tap of taps) {
      const src = (y * source.width + tap.index) * CHANNELS;
      const alpha = source.data[src + 3] as number;
      // Coverage is binary here: partial alpha has already contributed to the
      // visible RGB. Weighting it again would disagree with flattened artwork.
      // A void source pixel contributes white to a mixed cell's appearance,
      // never its hidden RGB; a wholly void output cell remains transparent.
      for (let channel = 0; channel < 3; channel += 1) {
        const value = alpha === 0 ? MAX_BYTE : visibleChannel(source, src, channel, alpha);
        row[out + channel] = (row[out + channel] as number) + value * tap.weight;
      }
      if (alpha > 0) row[out + 3] = (row[out + 3] as number) + tap.weight;
    }
  });
}

function visibleChannel(
  source: RawImageData,
  offset: number,
  channel: number,
  alpha: number,
): number {
  const value = source.data[offset + channel] as number;
  if (source.rgbCompositedOnWhite === true || alpha === MAX_BYTE) return value;
  const coverage = alpha / MAX_BYTE;
  // Match the byte-valued decoder representation before any averaging.
  return Math.round(value * coverage + MAX_BYTE * (1 - coverage));
}
