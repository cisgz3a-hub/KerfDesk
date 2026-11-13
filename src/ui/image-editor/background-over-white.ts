// The Background layer keeps the white-is-empty convention (ADR-245 §4): what
// it shows, and what burns, is its colour over white. An imported logo keeps
// its alpha there, and "Clean up white paper" writes alpha into it, so a point
// adjustment that maps RGB alone (Invert, Threshold, Levels, …) changed
// nothing visible or blanked the image (tools audit T1, T13-P2-1, T13R-P2-1).
// Flattening the pixels the adjustment touches over white first keeps the
// composite exactly as it was and lets the adjustment act on what is seen.

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../../core/image-edit';
import type { SelectionMask } from '../../core/image-select';

const MAX_BYTE = 255;

/** Composite each touched pixel over white and make it opaque, in place. */
export function flattenOverWhiteInPlace(
  doc: RgbaBuffer,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const area = clampedArea(doc, rect);
  for (let y = area.y0; y < area.y1; y += 1) {
    for (let x = area.x0; x < area.x1; x += 1) {
      const idx = y * doc.width + x;
      if (mask === null || (mask.alpha[idx] ?? 0) > 0) flattenPixel(doc.data, idx * RGBA_CHANNELS);
    }
  }
}

function clampedArea(doc: RgbaBuffer, rect: PixelRect | null) {
  if (rect === null) return { x0: 0, y0: 0, x1: doc.width, y1: doc.height };
  return {
    x0: Math.max(0, Math.floor(rect.x)),
    y0: Math.max(0, Math.floor(rect.y)),
    x1: Math.min(doc.width, Math.ceil(rect.x + rect.width)),
    y1: Math.min(doc.height, Math.ceil(rect.y + rect.height)),
  };
}

function flattenPixel(data: Uint8ClampedArray, base: number): void {
  const alpha = data[base + 3] ?? MAX_BYTE;
  if (alpha === MAX_BYTE) return;
  for (let c = 0; c < 3; c += 1) {
    const value = data[base + c] ?? MAX_BYTE;
    data[base + c] = Math.round((value * alpha + MAX_BYTE * (MAX_BYTE - alpha)) / MAX_BYTE);
  }
  data[base + 3] = MAX_BYTE;
}
