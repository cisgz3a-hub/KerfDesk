// Sub-pixel edge localisation. The stroke graph walks the BINARY Canny mask,
// so every raw chain vertex sits on the integer pixel lattice — the traced
// curve carries ±0.5px staircase noise that survives smoothing as visible
// lumps on small-letter turns. The blurred Sobel magnitude holds the true
// edge position to well under a pixel: refine each vertex by sampling the
// magnitude one pixel to either side ALONG THE GRADIENT (normal to the
// edge), fitting a parabola, and shifting the vertex to its peak
// (Devernay-style refinement). The shift is clamped far below one pixel, so
// a vertex can only move within the cell the edge mask already chose — this
// sharpens localisation, it never invents edges.

import type { Vec2 } from '../scene';

export type SubpixelField = {
  /** Pre-NMS gradient magnitude (blurred Sobel). */
  readonly gradMag: Float32Array;
  readonly gradX: Float32Array;
  readonly gradY: Float32Array;
  readonly width: number;
  readonly height: number;
};

// The mask already localised the edge to this cell; a peak offset beyond
// ~half a pixel is a neighbouring structure, not a better estimate.
const MAX_SHIFT_PX = 0.6;
const MIN_GRADIENT_LEN = 1e-6;
// The parabola must curve DOWNWARD around the sample (a genuine ridge
// crossing); flat or upward profiles (junction plateaus) keep the vertex.
const MIN_PEAK_CURVATURE = 1e-9;

/** Build a per-point snapper for the given gradient field. */
export function makeRidgeSnapper(field: SubpixelField): (p: Vec2) => Vec2 {
  return (p) => snapToRidge(field, p);
}

function snapToRidge(field: SubpixelField, p: Vec2): Vec2 {
  // Chain points sit at pixel centres (cell + 0.5); the arrays index cells.
  const cellX = p.x - 0.5;
  const cellY = p.y - 0.5;
  const ix = clampIndex(Math.round(cellX), field.width);
  const iy = clampIndex(Math.round(cellY), field.height);
  const gx = field.gradX[iy * field.width + ix] ?? 0;
  const gy = field.gradY[iy * field.width + ix] ?? 0;
  const gradLen = Math.hypot(gx, gy);
  if (gradLen < MIN_GRADIENT_LEN) return p;
  const ux = gx / gradLen;
  const uy = gy / gradLen;
  const magAt = bilinear(field, cellX, cellY);
  const magBefore = bilinear(field, cellX - ux, cellY - uy);
  const magAfter = bilinear(field, cellX + ux, cellY + uy);
  const curvature = magBefore + magAfter - 2 * magAt;
  if (curvature >= -MIN_PEAK_CURVATURE) return p;
  const peakOffset = (magBefore - magAfter) / (2 * curvature);
  const shift = Math.max(-MAX_SHIFT_PX, Math.min(MAX_SHIFT_PX, peakOffset));
  return { x: p.x + ux * shift, y: p.y + uy * shift };
}

function bilinear(field: SubpixelField, cellX: number, cellY: number): number {
  const cx = Math.min(Math.max(cellX, 0), field.width - 1);
  const cy = Math.min(Math.max(cellY, 0), field.height - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, field.width - 1);
  const y1 = Math.min(y0 + 1, field.height - 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const at = (x: number, y: number): number => field.gradMag[y * field.width + x] ?? 0;
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function clampIndex(value: number, size: number): number {
  return Math.min(Math.max(value, 0), size - 1);
}
