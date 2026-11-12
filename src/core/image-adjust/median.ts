// Median filter (ADR-242, PP-E) — the despeckle workhorse: each channel
// takes the median of its (2r+1)^2 neighbourhood, which erases salt-and-
// pepper scan noise while keeping edges sharp (a Gaussian would smear them).
//
// Each channel slides a 256-bin histogram along the row (Huang's running
// median, ADR-245 Amendment 2): one column leaves the window and one enters
// per pixel, and the median moves from where it was. Sorting every window
// took about 70 s per pass on a 12 MP photo at radius 2. The window is the
// same edge-clamped multiset as before, so the result is the same bytes.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';
import { clampRectToDoc, MAX_BYTE } from './lut';
import type { FilterProgress } from './filter-progress';

const RGB_CHANNELS = 3;
const LEVELS = 256;
// r=1..2 is the despeckle range; 4 bounds the window at 81 samples.
export const MAX_MEDIAN_RADIUS = 4;

export function medianInPlace(
  doc: RgbaBuffer,
  radius: number,
  rect: PixelRect | null,
  mask: SelectionMask | null,
  progress?: FilterProgress,
): void {
  const target = clampRectToDoc(doc, rect);
  const r = Math.min(MAX_MEDIAN_RADIUS, Math.max(1, Math.floor(radius)));
  if (target.width <= 0 || target.height <= 0) return;
  // Every window reads pre-filter values: medians are kept until all are known.
  const values = new Uint8Array(target.width * target.height * RGB_CHANNELS);
  const row: MedianRow = {
    doc,
    target,
    radius: r,
    rowOffsets: new Int32Array(2 * r + 1),
    histogram: new Int32Array(LEVELS),
    values,
  };
  for (let y = 0; y < target.height; y += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      const sy = Math.min(doc.height - 1, Math.max(0, target.y + y + dy));
      row.rowOffsets[dy + r] = sy * doc.width * RGBA_CHANNELS;
    }
    for (let c = 0; c < RGB_CHANNELS; c += 1) medianRowChannel(row, y, c);
    progress?.((y + 1) / target.height);
  }
  writeMaskedBytes(doc, target, values, mask);
}

type MedianRow = {
  readonly doc: RgbaBuffer;
  readonly target: PixelRect;
  readonly radius: number;
  /** Byte offset of each edge-clamped source row of the window, top to bottom. */
  readonly rowOffsets: Int32Array;
  readonly histogram: Int32Array;
  readonly values: Uint8Array;
};

// Slide the window along one target row for one channel. `below` counts the
// samples under `median`; `rank` is the sorted index the old sort picked,
// (n - 1) >> 1.
function medianRowChannel(row: MedianRow, y: number, channel: number): void {
  const { doc, target, radius, histogram, values } = row;
  const rank = ((2 * radius + 1) * (2 * radius + 1) - 1) >> 1;
  histogram.fill(0);
  for (let dx = -radius; dx <= radius; dx += 1) {
    addColumn(row, clampColumn(doc, target.x + dx), channel, 1);
  }
  let median = 0;
  let below = 0;
  while (below + (histogram[median] ?? 0) <= rank) {
    below += histogram[median] ?? 0;
    median += 1;
  }
  const outRow = y * target.width * RGB_CHANNELS + channel;
  for (let x = 0; x < target.width; x += 1) {
    values[outRow + x * RGB_CHANNELS] = median;
    if (x + 1 === target.width) break;
    const leaving = clampColumn(doc, target.x + x - radius);
    const entering = clampColumn(doc, target.x + x + 1 + radius);
    below += addColumn(row, leaving, channel, -1, median);
    below += addColumn(row, entering, channel, 1, median);
    while (below > rank) {
      median -= 1;
      below -= histogram[median] ?? 0;
    }
    while (below + (histogram[median] ?? 0) <= rank) {
      below += histogram[median] ?? 0;
      median += 1;
    }
  }
}

// Add (+1) or remove (-1) one window column; returns how many of its samples
// lie under `median`, signed like `delta`, so the caller keeps its count.
function addColumn(
  row: MedianRow,
  column: number,
  channel: number,
  delta: 1 | -1,
  median = 0,
): number {
  const { doc, rowOffsets, histogram } = row;
  const offset = column * RGBA_CHANNELS + channel;
  let under = 0;
  for (const rowOffset of rowOffsets) {
    const value = doc.data[rowOffset + offset] ?? 0;
    histogram[value] = (histogram[value] ?? 0) + delta;
    if (value < median) under += delta;
  }
  return under;
}

function clampColumn(doc: RgbaBuffer, x: number): number {
  return Math.min(doc.width - 1, Math.max(0, x));
}

// writeMasked's alpha-weighted write, for whole-number medians.
function writeMaskedBytes(
  doc: RgbaBuffer,
  rect: PixelRect,
  values: Uint8Array,
  mask: SelectionMask | null,
): void {
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const idx = (rect.y + y) * doc.width + (rect.x + x);
      const alpha = mask === null ? MAX_BYTE : (mask.alpha[idx] ?? 0);
      if (alpha === 0) continue;
      const srcBase = (y * rect.width + x) * RGB_CHANNELS;
      const dstBase = idx * RGBA_CHANNELS;
      for (let c = 0; c < RGB_CHANNELS; c += 1) {
        const source = doc.data[dstBase + c] ?? 0;
        const mapped = values[srcBase + c] ?? 0;
        doc.data[dstBase + c] =
          alpha === MAX_BYTE ? mapped : source + Math.round(((mapped - source) * alpha) / MAX_BYTE);
      }
    }
  }
}
