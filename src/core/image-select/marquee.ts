// Rectangle / ellipse marquee selections (ADR-242, flow F-L2).
//
// A pixel is selected iff its centre lies inside the marquee shape — the same
// pixel-centre sampling rule as the brush stamps and the perceptual harness,
// so selections, paint, and tests agree about what "inside" means.

import type { PixelRect } from '../image-edit';
import { createEmptyMask, MASK_SOLID, type SelectionMask } from './selection-mask';

export function rectSelection(width: number, height: number, rect: PixelRect): SelectionMask {
  const mask = createEmptyMask(width, height);
  // Pixel centre p+0.5 is selected iff it lies in the half-open span
  // [x, x+width): inclusive left edge, exclusive right edge.
  const left = Math.max(0, Math.ceil(rect.x - 0.5));
  const top = Math.max(0, Math.ceil(rect.y - 0.5));
  const right = Math.min(mask.width, Math.ceil(rect.x + rect.width - 0.5));
  const bottom = Math.min(mask.height, Math.ceil(rect.y + rect.height - 0.5));
  for (let y = top; y < bottom; y += 1) {
    mask.alpha.fill(MASK_SOLID, y * mask.width + left, y * mask.width + right);
  }
  return mask;
}

export function ellipseSelection(width: number, height: number, rect: PixelRect): SelectionMask {
  const mask = createEmptyMask(width, height);
  const rx = rect.width / 2;
  const ry = rect.height / 2;
  if (rx <= 0 || ry <= 0) return mask;
  const cx = rect.x + rx;
  const cy = rect.y + ry;
  for (let y = 0; y < mask.height; y += 1) {
    const ny = (y + 0.5 - cy) / ry;
    if (Math.abs(ny) > 1) continue;
    for (let x = 0; x < mask.width; x += 1) {
      const nx = (x + 0.5 - cx) / rx;
      if (nx * nx + ny * ny <= 1) mask.alpha[y * mask.width + x] = MASK_SOLID;
    }
  }
  return mask;
}
