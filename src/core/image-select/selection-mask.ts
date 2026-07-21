// Selection masks for the Image Studio (ADR-242, flow F-L2).
//
// A mask carries one alpha byte per document pixel: 0 = unselected, 255 =
// fully selected. The byte range exists so feathered (soft) selections drop
// in later without a model change; every op in this increment writes hard
// 0/255 values. Masks are ~1 byte/px, so selection ops return new masks —
// only document-compositing ops (region-ops.ts) mutate pixels, and those
// carry the module's `InPlace` suffix contract.

import type { PixelRect } from '../image-edit';

export const MASK_SOLID = 255;
/** A pixel counts as selected for binary decisions at or above this alpha. */
export const MASK_SELECTED_THRESHOLD = 128;

export type SelectionMask = {
  readonly width: number;
  readonly height: number;
  /** One alpha byte per pixel, row-major, length === width * height. */
  readonly alpha: Uint8Array;
};

export function createEmptyMask(width: number, height: number): SelectionMask {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  return { width: w, height: h, alpha: new Uint8Array(w * h) };
}

export function selectAllMask(width: number, height: number): SelectionMask {
  const mask = createEmptyMask(width, height);
  mask.alpha.fill(MASK_SOLID);
  return mask;
}

export function isMaskEmpty(mask: SelectionMask): boolean {
  return !mask.alpha.some((alpha) => alpha > 0);
}

/** Select-inverse (Ctrl+Shift+I): alpha complement per pixel. */
export function invertMask(mask: SelectionMask): SelectionMask {
  const alpha = new Uint8Array(mask.alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = MASK_SOLID - (mask.alpha[i] ?? 0);
  }
  return { width: mask.width, height: mask.height, alpha };
}

/** Tight bounds of every selected (alpha > 0) pixel; null for an empty mask. */
export function maskBounds(mask: SelectionMask): PixelRect | null {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if ((mask.alpha[y * mask.width + x] ?? 0) === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
