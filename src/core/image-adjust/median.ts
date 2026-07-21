// Median filter (ADR-242, PP-E) — the despeckle workhorse: each channel
// takes the median of its (2r+1)^2 neighbourhood, which erases salt-and-
// pepper scan noise while keeping edges sharp (a Gaussian would smear them).

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';
import { writeMasked } from './gaussian-blur';
import { clampRectToDoc } from './lut';

const RGB_CHANNELS = 3;
// Naive window gather: r=1..2 is the despeckle range; 4 bounds the cost.
export const MAX_MEDIAN_RADIUS = 4;

export function medianInPlace(
  doc: RgbaBuffer,
  radius: number,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const target = clampRectToDoc(doc, rect);
  const r = Math.min(MAX_MEDIAN_RADIUS, Math.max(1, Math.floor(radius)));
  if (target.width <= 0 || target.height <= 0) return;
  // Snapshot so every window reads pre-filter values, not written ones.
  const source = new Uint8ClampedArray(doc.data);
  const values = new Float32Array(target.width * target.height * RGB_CHANNELS);
  const window = new Array<number>((2 * r + 1) * (2 * r + 1));
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const outBase = (y * target.width + x) * RGB_CHANNELS;
      for (let c = 0; c < RGB_CHANNELS; c += 1) {
        values[outBase + c] = channelMedian(
          source,
          doc,
          { x: target.x + x, y: target.y + y, radius: r, channel: c },
          window,
        );
      }
    }
  }
  writeMasked(doc, target, values, mask);
}

type WindowSpec = {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly channel: number;
};

// Gather the edge-clamped window for one channel into the reused scratch
// array, sort, and take the middle value.
function channelMedian(
  source: Uint8ClampedArray,
  doc: RgbaBuffer,
  spec: WindowSpec,
  window: number[],
): number {
  let n = 0;
  for (let dy = -spec.radius; dy <= spec.radius; dy += 1) {
    const sy = Math.min(doc.height - 1, Math.max(0, spec.y + dy));
    for (let dx = -spec.radius; dx <= spec.radius; dx += 1) {
      const sx = Math.min(doc.width - 1, Math.max(0, spec.x + dx));
      window[n] = source[(sy * doc.width + sx) * RGBA_CHANNELS + spec.channel] ?? 0;
      n += 1;
    }
  }
  window.sort((a, b) => a - b);
  return window[(n - 1) >> 1] ?? 0;
}
