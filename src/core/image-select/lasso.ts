// Freehand / polygonal lasso selection (ADR-242, flow F-L2).
//
// The pointer path closes implicitly (last point joins the first) and fills
// with the even-odd scanline rule sampled at pixel centres — the same parity
// convention as fill-hatching and the perceptual rasterizer, so a
// self-crossing lasso keeps holes hollow instead of flooding them.

import type { PaintPoint } from '../image-edit';
import { createEmptyMask, MASK_SOLID, type SelectionMask } from './selection-mask';

const MIN_POLYGON_POINTS = 3;

export function polygonSelection(
  width: number,
  height: number,
  points: readonly PaintPoint[],
): SelectionMask {
  const mask = createEmptyMask(width, height);
  if (points.length < MIN_POLYGON_POINTS) return mask;
  for (let y = 0; y < mask.height; y += 1) {
    const scanY = y + 0.5;
    const crossings = collectCrossings(points, scanY);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const enter = crossings[i] ?? 0;
      const exit = crossings[i + 1] ?? 0;
      const left = Math.max(0, Math.ceil(enter - 0.5));
      const right = Math.min(mask.width - 1, Math.floor(exit - 0.5));
      if (right < left) continue;
      mask.alpha.fill(MASK_SOLID, y * mask.width + left, y * mask.width + right + 1);
    }
  }
  return mask;
}

// Half-open [yLo, yHi) edge rule: a vertex exactly on the scanline counts for
// the edge going down from it, never both edges — no double-crossings.
function collectCrossings(points: readonly PaintPoint[], scanY: number): number[] {
  const crossings: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    const yLo = Math.min(a.y, b.y);
    const yHi = Math.max(a.y, b.y);
    if (scanY < yLo || scanY >= yHi) continue;
    const t = (scanY - a.y) / (b.y - a.y);
    crossings.push(a.x + (b.x - a.x) * t);
  }
  crossings.sort((left, right) => left - right);
  return crossings;
}
