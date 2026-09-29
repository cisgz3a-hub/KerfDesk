// Gaussian blur approximated by three successive box blurs, as Filter Effects
// Level 1 allows for feGaussianBlur (C-3). Each box is a running sum, so the
// cost per pixel is the same at every radius; the exact kernel costs
// pixels x (6 sigma + 1) taps and froze Image Studio on phone photos.
//
// Sampling matches the exact kernel in gaussian-blur.ts: rows and columns
// outside the document repeat its edge pixels, and rect-edge pixels see their
// true neighbours outside the rect.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import { clamp } from '../math';

const RGB_CHANNELS = 3;
const BOX_PASSES = 3;
// Columns blurred together down the image, and rows together across it: enough
// independent running sums to keep the processor busy, few enough that the
// working buffers stay small.
const STRIP_COLUMNS = 64;
const ROW_BLOCK = 16;

/** A box of `radius` plus `endWeight` of the next sample on each side. */
export type ExtendedBox = { readonly radius: number; readonly endWeight: number };

/**
 * The extended box, used three times, whose passes together have exactly the
 * Gaussian's variance (Gwosdek et al., "Theoretical Foundations of Gaussian
 * Convolution by Extended Box Filtering", 2011). Whole-pixel boxes miss the
 * variance between widths: on a hard edge they measured 7.8 levels from the
 * exact kernel at the default sigma of 2, and the Filter Effects width 8.8 at
 * sigma 5. Matching it leaves only the shape difference, about 4 levels.
 */
export function extendedBox(sigma: number): ExtendedBox {
  const variance = (sigma * sigma) / BOX_PASSES;
  // The widest whole box whose variance, r(r + 1) / 3, does not exceed it.
  const radius = Math.floor(Math.sqrt(12 * variance + 1) / 2 - 0.5);
  const endWeight =
    ((2 * radius + 1) * (3 * variance - radius * (radius + 1))) /
    (6 * ((radius + 1) ** 2 - variance));
  return { radius, endWeight };
}

/** Blurred RGB floats for the rect, row-major, length rect.w * rect.h * 3. */
export function boxBlurredRect(doc: RgbaBuffer, sigma: number, rect: PixelRect): Float32Array {
  const box = extendedBox(sigma);
  const reach = BOX_PASSES * (box.radius + 1);
  // The horizontal passes cover the rows the vertical passes read.
  const top = Math.max(0, rect.y - reach);
  const bottom = Math.min(doc.height, rect.y + rect.height + reach);
  const horizontal = blurRows(doc, rect, { top, bottom }, box, reach);
  return blurColumns(horizontal, rect, { top, bottom }, box, reach);
}

type RowSpan = { readonly top: number; readonly bottom: number };

// Values per row of a lane buffer, `stride` apart, `width` of them in use, each
// with its own running sum.
type Lanes = {
  readonly stride: number;
  readonly width: number;
  readonly box: ExtendedBox;
  readonly sums: Float64Array;
};

// Blur the needed document rows across the rect's columns, a block of rows at
// a time: position along the row is the lane buffer's row and every channel of
// every row in the block is a lane, so the running sums advance side by side.
// Each row is loaded with `reach` edge-extended pixels each side.
function blurRows(
  doc: RgbaBuffer,
  rect: PixelRect,
  span: RowSpan,
  box: ExtendedBox,
  reach: number,
): Float32Array {
  const length = rect.width + 2 * reach;
  const stride = ROW_BLOCK * RGB_CHANNELS;
  const first = new Float32Array(length * stride);
  const second = new Float32Array(length * stride);
  const sums = new Float64Array(stride);
  const out = new Float32Array(rect.width * (span.bottom - span.top) * RGB_CHANNELS);
  for (let y0 = span.top; y0 < span.bottom; y0 += ROW_BLOCK) {
    const block = Math.min(ROW_BLOCK, span.bottom - y0);
    for (let i = 0; i < length; i += 1) {
      const x = clamp(rect.x - reach + i, 0, doc.width - 1);
      for (let row = 0; row < block; row += 1) {
        const from = ((y0 + row) * doc.width + x) * RGBA_CHANNELS;
        const to = i * stride + row * RGB_CHANNELS;
        first[to] = doc.data[from] ?? 0;
        first[to + 1] = doc.data[from + 1] ?? 0;
        first[to + 2] = doc.data[from + 2] ?? 0;
      }
    }
    const width = block * RGB_CHANNELS;
    const blurred = blurLanes(first, second, length, { stride, width, box, sums });
    for (let row = 0; row < block; row += 1) {
      const outRow = (y0 + row - span.top) * rect.width;
      for (let x = 0; x < rect.width; x += 1) {
        const from = (reach + x) * stride + row * RGB_CHANNELS;
        const to = (outRow + x) * RGB_CHANNELS;
        out[to] = blurred[from] ?? 0;
        out[to + 1] = blurred[from + 1] ?? 0;
        out[to + 2] = blurred[from + 2] ?? 0;
      }
    }
  }
  return out;
}

// Blur down the rect in strips of columns, so every read and write runs along
// memory. Rows outside the document repeat its edge rows.
function blurColumns(
  horizontal: Float32Array,
  rect: PixelRect,
  span: RowSpan,
  box: ExtendedBox,
  reach: number,
): Float32Array {
  const rows = rect.height + 2 * reach;
  const stride = Math.min(STRIP_COLUMNS, rect.width) * RGB_CHANNELS;
  const first = new Float32Array(rows * stride);
  const second = new Float32Array(rows * stride);
  const sums = new Float64Array(stride);
  const out = new Float32Array(rect.width * rect.height * RGB_CHANNELS);
  const rowValues = rect.width * RGB_CHANNELS;
  for (let x0 = 0; x0 < rect.width; x0 += STRIP_COLUMNS) {
    const width = Math.min(STRIP_COLUMNS, rect.width - x0) * RGB_CHANNELS;
    const column = x0 * RGB_CHANNELS;
    for (let i = 0; i < rows; i += 1) {
      const row = clamp(rect.y - reach + i, span.top, span.bottom - 1) - span.top;
      const from = row * rowValues + column;
      first.set(horizontal.subarray(from, from + width), i * stride);
    }
    const blurred = blurLanes(first, second, rows, { stride, width, box, sums });
    for (let y = 0; y < rect.height; y += 1) {
      const from = (reach + y) * stride;
      out.set(blurred.subarray(from, from + width), y * rowValues + column);
    }
  }
  return out;
}

// Run the three passes down rows [0, rows) of `first`. Each pass is valid on a
// range one box reach narrower at both ends, so after all three the rows from
// `reach` to `rows - reach` hold the blur. Returns the buffer holding them.
function blurLanes(
  first: Float32Array,
  second: Float32Array,
  rows: number,
  lanes: Lanes,
): Float32Array {
  let source = first;
  let target = second;
  let start = 0;
  let end = rows;
  for (let pass = 0; pass < BOX_PASSES; pass += 1) {
    start += lanes.box.radius + 1;
    end -= lanes.box.radius + 1;
    boxPass(source, target, start, end, lanes);
    [source, target] = [target, source];
  }
  return source;
}

// One extended-box pass written over rows [start, end), reading one row beyond
// the box each side. The running sums carry the whole-pixel part of the box.
function boxPass(
  source: Float32Array,
  target: Float32Array,
  start: number,
  end: number,
  lanes: Lanes,
): void {
  const { stride, width, sums } = lanes;
  const { radius, endWeight } = lanes.box;
  const scale = 1 / (2 * radius + 1 + 2 * endWeight);
  sums.fill(0, 0, width);
  for (let row = start - radius; row < start + radius; row += 1) {
    for (let k = 0; k < width; k += 1) sums[k] = (sums[k] ?? 0) + (source[row * stride + k] ?? 0);
  }
  for (let row = start; row < end; row += 1) {
    const entering = (row + radius) * stride;
    const leaving = (row - radius) * stride;
    const before = (row - radius - 1) * stride;
    const after = (row + radius + 1) * stride;
    const at = row * stride;
    for (let k = 0; k < width; k += 1) {
      const sum = (sums[k] ?? 0) + (source[entering + k] ?? 0);
      const ends = (source[before + k] ?? 0) + (source[after + k] ?? 0);
      target[at + k] = (sum + endWeight * ends) * scale;
      sums[k] = sum - (source[leaving + k] ?? 0);
    }
  }
}
