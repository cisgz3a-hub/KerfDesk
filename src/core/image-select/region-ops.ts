// Selected-area operations on the working document (ADR-242, flow F-L2).
//
// Delete = fill white (white neither burns nor traces), Fill = fill colour,
// Move = extract a floating region, white-fill the source, blit at the drop
// offset — the UI composes those three primitives around its history
// captures. All blends weight by mask alpha / 255 so feathered selections
// composite correctly when they arrive.

import type { PaintColor, PixelRect, RgbaBuffer } from '../image-edit';
import { RGBA_CHANNELS } from '../image-edit';
import { MASK_SOLID, maskBounds, type SelectionMask } from './selection-mask';

const EMPTY_RECT: PixelRect = { x: 0, y: 0, width: 0, height: 0 };

/** A cut-out selection travelling with the pointer during a move. */
export type FloatingRegion = {
  readonly rect: PixelRect;
  /** RGBA8 crop of rect, row-major. */
  readonly pixels: Uint8ClampedArray;
  /** Mask alpha crop of rect, row-major. */
  readonly alpha: Uint8Array;
};

/**
 * Blend `color` into every selected pixel, weighted by mask alpha. Returns
 * the touched bounds (capture history for this rect BEFORE calling).
 */
export function fillMaskedInPlace(
  buffer: RgbaBuffer,
  mask: SelectionMask,
  color: PaintColor,
): PixelRect {
  const bounds = maskBounds(mask);
  if (bounds === null) return EMPTY_RECT;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      const alpha = (mask.alpha[y * mask.width + x] ?? 0) / MASK_SOLID;
      if (alpha === 0) continue;
      const base = (y * buffer.width + x) * RGBA_CHANNELS;
      blend(buffer, base, color.r, alpha);
      blend(buffer, base + 1, color.g, alpha);
      blend(buffer, base + 2, color.b, alpha);
      buffer.data[base + 3] = 255;
    }
  }
  return bounds;
}

function blend(buffer: RgbaBuffer, index: number, target: number, alpha: number): void {
  const current = buffer.data[index] ?? 0;
  buffer.data[index] = Math.round(target * alpha + current * (1 - alpha));
}

/** Copy the selected pixels (and their mask crop) out of the document. */
export function extractFloatingRegion(
  buffer: RgbaBuffer,
  mask: SelectionMask,
): FloatingRegion | null {
  const rect = maskBounds(mask);
  if (rect === null) return null;
  const pixels = new Uint8ClampedArray(rect.width * rect.height * RGBA_CHANNELS);
  const alpha = new Uint8Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row += 1) {
    const srcY = rect.y + row;
    for (let col = 0; col < rect.width; col += 1) {
      const srcX = rect.x + col;
      const local = row * rect.width + col;
      alpha[local] = mask.alpha[srcY * mask.width + srcX] ?? 0;
      const src = (srcY * buffer.width + srcX) * RGBA_CHANNELS;
      pixels.set(buffer.data.subarray(src, src + RGBA_CHANNELS), local * RGBA_CHANNELS);
    }
  }
  return { rect, pixels, alpha };
}

/**
 * Composite a floating region at its rect translated by (dx, dy), clamped to
 * the document. Returns the touched bounds (empty when fully off-document).
 */
export function blitFloatingInPlace(
  buffer: RgbaBuffer,
  floating: FloatingRegion,
  dx: number,
  dy: number,
): PixelRect {
  const destX = floating.rect.x + Math.round(dx);
  const destY = floating.rect.y + Math.round(dy);
  const left = Math.max(0, destX);
  const top = Math.max(0, destY);
  const right = Math.min(buffer.width, destX + floating.rect.width);
  const bottom = Math.min(buffer.height, destY + floating.rect.height);
  if (right <= left || bottom <= top) return EMPTY_RECT;
  for (let y = top; y < bottom; y += 1) {
    const row = y - destY;
    for (let x = left; x < right; x += 1) {
      const local = row * floating.rect.width + (x - destX);
      const alpha = (floating.alpha[local] ?? 0) / MASK_SOLID;
      if (alpha === 0) continue;
      const src = local * RGBA_CHANNELS;
      const dest = (y * buffer.width + x) * RGBA_CHANNELS;
      blend(buffer, dest, floating.pixels[src] ?? 0, alpha);
      blend(buffer, dest + 1, floating.pixels[src + 1] ?? 0, alpha);
      blend(buffer, dest + 2, floating.pixels[src + 2] ?? 0, alpha);
      buffer.data[dest + 3] = 255;
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
