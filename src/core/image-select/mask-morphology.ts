// Selection Modify operations (ADR-242 parity plan PP-B, Top-20 item 18):
// Expand / Contract / Border / Smooth / Feather, matching Photoshop's
// Select ▸ Modify pixel-amount semantics.
//
// Expand/contract are separable square max/min filters (chamfer-square
// structuring element — Photoshop's own modify uses a similar square bias);
// feather is a triple box blur (≈ gaussian) over the alpha mask; smooth is a
// binary-median round trip; border = expand minus contract.

import { combineMasks } from './combine-masks';
import { MASK_SELECTED_THRESHOLD, MASK_SOLID, type SelectionMask } from './selection-mask';

const MAX_MODIFY_RADIUS_PX = 500;

export function expandMask(mask: SelectionMask, radiusPx: number): SelectionMask {
  return separableExtreme(mask, clampRadius(radiusPx), Math.max);
}

export function contractMask(mask: SelectionMask, radiusPx: number): SelectionMask {
  return separableExtreme(mask, clampRadius(radiusPx), Math.min);
}

/** A band of the given thickness centred on the selection edge. */
export function borderMask(mask: SelectionMask, thicknessPx: number): SelectionMask {
  const radius = Math.max(1, Math.round(clampRadius(thicknessPx) / 2));
  return combineMasks(expandMask(mask, radius), contractMask(mask, radius), 'subtract');
}

/** Round off jagged edges: feather then re-threshold to a hard mask. */
export function smoothMask(mask: SelectionMask, radiusPx: number): SelectionMask {
  const blurred = featherMask(mask, clampRadius(radiusPx));
  const alpha = new Uint8Array(blurred.alpha.length);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = (blurred.alpha[i] ?? 0) >= MASK_SELECTED_THRESHOLD ? MASK_SOLID : 0;
  }
  return { width: mask.width, height: mask.height, alpha };
}

/** Soft-edge the selection: triple box blur approximates a gaussian. */
export function featherMask(mask: SelectionMask, radiusPx: number): SelectionMask {
  const radius = clampRadius(radiusPx);
  if (radius === 0) return mask;
  // Three box passes of radius/3 approximate a gaussian of sigma ~radius/2.
  const boxRadius = Math.max(1, Math.round(radius / 3));
  let alpha = mask.alpha;
  for (let pass = 0; pass < 3; pass += 1) {
    alpha = boxBlurAxis(alpha, mask.width, mask.height, boxRadius, true);
    alpha = boxBlurAxis(alpha, mask.width, mask.height, boxRadius, false);
  }
  return { width: mask.width, height: mask.height, alpha };
}

function clampRadius(radiusPx: number): number {
  return Math.min(MAX_MODIFY_RADIUS_PX, Math.max(0, Math.round(radiusPx)));
}

// Separable running extreme (max = dilate, min = erode) over rows then
// columns — O(n·r) with small constants, exact for the square element.
function separableExtreme(
  mask: SelectionMask,
  radius: number,
  pick: (a: number, b: number) => number,
): SelectionMask {
  if (radius === 0) return mask;
  const rows = extremeAxis(mask.alpha, mask.width, mask.height, radius, pick, true);
  const alpha = extremeAxis(rows, mask.width, mask.height, radius, pick, false);
  return { width: mask.width, height: mask.height, alpha };
}

function extremeAxis(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  pick: (a: number, b: number) => number,
  horizontal: boolean,
): Uint8Array {
  const out = new Uint8Array(source.length);
  const lineCount = horizontal ? height : width;
  const lineLength = horizontal ? width : height;
  const stride = horizontal ? 1 : width;
  for (let line = 0; line < lineCount; line += 1) {
    const base = horizontal ? line * width : line;
    for (let i = 0; i < lineLength; i += 1) {
      const lo = Math.max(0, i - radius);
      const hi = Math.min(lineLength - 1, i + radius);
      let value = source[base + lo * stride] ?? 0;
      for (let j = lo + 1; j <= hi; j += 1) {
        value = pick(value, source[base + j * stride] ?? 0);
      }
      out[base + i * stride] = value;
    }
  }
  return out;
}

function boxBlurAxis(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): Uint8Array {
  const out = new Uint8Array(source.length);
  const lineCount = horizontal ? height : width;
  const lineLength = horizontal ? width : height;
  const stride = horizontal ? 1 : width;
  const window = radius * 2 + 1;
  for (let line = 0; line < lineCount; line += 1) {
    const base = horizontal ? line * width : line;
    let sum = 0;
    // Prime the clamped window around index 0.
    for (let j = -radius; j <= radius; j += 1) {
      sum += source[base + clampIndex(j, lineLength) * stride] ?? 0;
    }
    for (let i = 0; i < lineLength; i += 1) {
      out[base + i * stride] = Math.round(sum / window);
      const leaving = clampIndex(i - radius, lineLength);
      const entering = clampIndex(i + radius + 1, lineLength);
      sum += (source[base + entering * stride] ?? 0) - (source[base + leaving * stride] ?? 0);
    }
  }
  return out;
}

function clampIndex(index: number, length: number): number {
  return Math.min(length - 1, Math.max(0, index));
}
