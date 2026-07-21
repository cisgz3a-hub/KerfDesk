// Luma histogram for the Levels/Curves dialogs (ADR-242, parity plan PP-E).

import type { PixelRect, RgbaBuffer } from '../image-edit';
import { RGBA_CHANNELS } from '../image-edit';
import type { SelectionMask } from '../image-select';
import { clampRectToDoc, LUT_SIZE, lumaByte } from './lut';

// Mirrors image-select's MASK_SELECTED_THRESHOLD (not exported from its
// barrel): a feathered pixel counts toward the histogram at half coverage.
const HISTOGRAM_MASK_MIN_ALPHA = 128;

/**
 * 256-bin Rec.601 luma histogram over the rect (null = whole document),
 * restricted to the selection when a mask is present.
 */
export function lumaHistogram(
  doc: RgbaBuffer,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): Uint32Array {
  const bins = new Uint32Array(LUT_SIZE);
  const r = clampRectToDoc(doc, rect);
  for (let y = r.y; y < r.y + r.height; y += 1) {
    for (let x = r.x; x < r.x + r.width; x += 1) {
      const idx = y * doc.width + x;
      if (mask !== null && (mask.alpha[idx] ?? 0) < HISTOGRAM_MASK_MIN_ALPHA) continue;
      const base = idx * RGBA_CHANNELS;
      const luma = lumaByte(doc.data[base] ?? 0, doc.data[base + 1] ?? 0, doc.data[base + 2] ?? 0);
      bins[luma] = (bins[luma] ?? 0) + 1;
    }
  }
  return bins;
}
