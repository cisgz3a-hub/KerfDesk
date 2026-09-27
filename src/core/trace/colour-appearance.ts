// Colour layers trace visible sRGB over white, with alpha=0 remaining void.
// The decoder already composites RGB and tags it; straight RGBA needs exactly
// one composite. Normalize before averaging so alpha is never applied twice.
// Large images read this appearance on demand into a bounded two-row cache,
// avoiding an additional full-source RGBA allocation before the working cap.
// Anti-aliased fringe against transparency stays void (ADR-461 Amendment 1):
// a partial pixel reached from alpha=0 whose alpha is under half the nearby
// ink's keeps the edge at ~50 % coverage, while translucent ink itself (alpha
// near its own local peak, even below 128) is still traced.

import { axisContributions, type AxisTap } from '../image-resample/resample-axis';
import type { RawImageData } from './trace-image';

const CHANNELS = 4;
const MAX_BYTE = 255;
// The nearby ink's opacity is the peak alpha within this many pixels.
const FRINGE_REACH = 2;

/** Native-resolution appearance; opaque/void-only inputs need no new buffer. */
export function colourAppearance(source: RawImageData): RawImageData {
  const fringe = transparencyFringe(source);
  let data: Uint8ClampedArray | undefined;
  for (let offset = 0; offset < source.data.length; offset += CHANNELS) {
    const alpha = source.data[offset + 3] as number;
    if (alpha === 0 || alpha === MAX_BYTE) continue;
    data ??= source.data.slice();
    if (fringe?.[offset / CHANNELS] === 1) {
      data[offset + 3] = 0;
      continue;
    }
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
  const fringe = transparencyFringe(source);
  const horizontal = axisContributions(source.width, width);
  const vertical = axisContributions(source.height, height);
  const rows = new Map<number, Float64Array>();
  const data = new Uint8ClampedArray(width * height * CHANNELS);
  const accumulated = new Float64Array(width * CHANNELS);
  for (let y = 0; y < height; y += 1) {
    accumulated.fill(0);
    for (const tap of vertical[y] ?? []) {
      const row = cachedRow(source, fringe, tap.index, horizontal, rows);
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
  fringe: Uint8Array | null,
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
  horizontalRow(source, fringe, y, contributions, row);
  cache.set(y, row);
  return row;
}

function horizontalRow(
  source: RawImageData,
  fringe: Uint8Array | null,
  y: number,
  contributions: readonly (readonly AxisTap[])[],
  row: Float64Array,
): void {
  row.fill(0);
  contributions.forEach((taps, x) => {
    const out = x * CHANNELS;
    for (const tap of taps) {
      const pixel = y * source.width + tap.index;
      const src = pixel * CHANNELS;
      const alpha = fringe?.[pixel] === 1 ? 0 : (source.data[src + 3] as number);
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

/** Partial-alpha pixels that are anti-aliased fringe of nearby, more opaque
 *  ink and connect (8-way, through such fringe) to an alpha=0 pixel; null
 *  when there are none. Alpha >= 128 is never fringe, so this voids a subset
 *  of what the former alpha-128 cutoff voided. */
export function transparencyFringe(source: RawImageData): Uint8Array | null {
  const { width, height } = source;
  const alphaAt = (p: number): number => source.data[p * CHANNELS + 3] as number;
  let mask: Uint8Array | null = null;
  const stack: number[] = [];
  const isFringe = (p: number): boolean => {
    const alpha = alphaAt(p);
    return alpha > 0 && alpha < MAX_BYTE && 2 * alpha < localPeak(source, p);
  };
  for (let p = 0; p < width * height; p += 1) {
    if (mask?.[p] === 1 || !isFringe(p) || !touches(source, p, (q) => alphaAt(q) === 0)) continue;
    mask ??= new Uint8Array(width * height);
    mask[p] = 1;
    stack.push(p);
    while (stack.length > 0) {
      touches(source, stack.pop() as number, (q) => {
        if (mask?.[q] === 1 || !isFringe(q)) return false;
        (mask as Uint8Array)[q] = 1;
        stack.push(q);
        return false;
      });
    }
  }
  return mask;
}

// True when any 8-neighbour of p satisfies `test` (every neighbour is visited
// until one does).
function touches(source: RawImageData, p: number, test: (q: number) => boolean): boolean {
  const x = p % source.width;
  const y = (p - x) / source.width;
  for (let yy = Math.max(0, y - 1); yy <= Math.min(source.height - 1, y + 1); yy += 1) {
    for (let xx = Math.max(0, x - 1); xx <= Math.min(source.width - 1, x + 1); xx += 1) {
      if ((xx !== x || yy !== y) && test(yy * source.width + xx)) return true;
    }
  }
  return false;
}

function localPeak(source: RawImageData, p: number): number {
  const x = p % source.width;
  const y = (p - x) / source.width;
  let peak = 0;
  const y1 = Math.min(source.height - 1, y + FRINGE_REACH);
  const x1 = Math.min(source.width - 1, x + FRINGE_REACH);
  for (let yy = Math.max(0, y - FRINGE_REACH); yy <= y1; yy += 1) {
    for (let xx = Math.max(0, x - FRINGE_REACH); xx <= x1; xx += 1) {
      peak = Math.max(peak, source.data[(yy * source.width + xx) * CHANNELS + 3] as number);
    }
  }
  return peak;
}
