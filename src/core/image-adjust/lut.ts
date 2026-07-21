// Tone-lookup application for the Image Studio adjustments core (ADR-242,
// parity plan PP-E).
//
// Every point adjustment reduces to a 256-entry lookup table. Per-channel
// application (brightness/contrast, levels, curves, invert, posterize) maps
// R, G, B independently; luma application (threshold, grayscale) maps the
// pixel's Rec.601 luma and writes the result to all three channels. Both
// clamp to an optional selection mask, alpha-weighted so feathered
// selections blend smoothly, and both follow the module's `InPlace`
// mutation contract (ADR-242 bounded exception).

import { RGBA_CHANNELS, type PixelRect, type RgbaBuffer } from '../image-edit';
import type { SelectionMask } from '../image-select';

export const LUT_SIZE = 256;
export const MAX_BYTE = 255;
const RGB_CHANNELS = 3;

// Rec.601 luma weights — the same greyscale convention the trace and engrave
// pipelines use, so a thresholded document burns exactly as previewed.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

export function lumaByte(r: number, g: number, b: number): number {
  return Math.round(LUMA_R * r + LUMA_G * g + LUMA_B * b);
}

/** Intersect an optional target rect with the document bounds. */
export function clampRectToDoc(doc: RgbaBuffer, rect: PixelRect | null): PixelRect {
  if (rect === null) return { x: 0, y: 0, width: doc.width, height: doc.height };
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  return {
    x,
    y,
    width: Math.min(doc.width, Math.ceil(rect.x + rect.width)) - x,
    height: Math.min(doc.height, Math.ceil(rect.y + rect.height)) - y,
  };
}

/**
 * Map each RGB channel through `lut`, alpha-weighted by the selection mask
 * (null mask = whole document). The alpha channel is never touched.
 */
export function applyLutInPlace(
  doc: RgbaBuffer,
  lut: Uint8Array,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const r = clampRectToDoc(doc, rect);
  for (let y = r.y; y < r.y + r.height; y += 1) {
    for (let x = r.x; x < r.x + r.width; x += 1) {
      const idx = y * doc.width + x;
      const alpha = mask === null ? MAX_BYTE : (mask.alpha[idx] ?? 0);
      if (alpha === 0) continue;
      const base = idx * RGBA_CHANNELS;
      for (let c = 0; c < RGB_CHANNELS; c += 1) {
        const value = doc.data[base + c] ?? 0;
        doc.data[base + c] = blendByte(value, lut[value] ?? 0, alpha);
      }
    }
  }
}

/**
 * Map each pixel's luma through `lut` and write the mapped grey to all three
 * channels (threshold, desaturate), alpha-weighted by the selection mask.
 */
export function applyLumaLutInPlace(
  doc: RgbaBuffer,
  lut: Uint8Array,
  rect: PixelRect | null,
  mask: SelectionMask | null,
): void {
  const r = clampRectToDoc(doc, rect);
  for (let y = r.y; y < r.y + r.height; y += 1) {
    for (let x = r.x; x < r.x + r.width; x += 1) {
      const idx = y * doc.width + x;
      const alpha = mask === null ? MAX_BYTE : (mask.alpha[idx] ?? 0);
      if (alpha === 0) continue;
      const base = idx * RGBA_CHANNELS;
      const luma = lumaByte(doc.data[base] ?? 0, doc.data[base + 1] ?? 0, doc.data[base + 2] ?? 0);
      const grey = lut[luma] ?? 0;
      for (let c = 0; c < RGB_CHANNELS; c += 1) {
        doc.data[base + c] = blendByte(doc.data[base + c] ?? 0, grey, alpha);
      }
    }
  }
}

// Feathered-mask blend: full alpha takes the mapped value outright, partial
// alpha lerps source toward mapped so soft selection edges stay soft.
function blendByte(source: number, mapped: number, alpha: number): number {
  if (alpha === MAX_BYTE) return mapped;
  return source + Math.round(((mapped - source) * alpha) / MAX_BYTE);
}
