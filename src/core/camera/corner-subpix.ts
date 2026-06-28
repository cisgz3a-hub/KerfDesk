// Sub-pixel corner refinement (ADR-095, calibration v2.b). At a true
// checkerboard corner every nearby image gradient is perpendicular to the
// vector from the corner, so the refined point q solves
//   (Σ g·gᵀ) q = Σ (g·gᵀ) p   over a Gaussian-weighted window, iterated.
// Pure core: operates on an injected single-channel grayscale buffer.

/** A row-major single-channel intensity image (number[], Float64Array, ...). */
export type GrayImage = {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
};

type Point = { readonly x: number; readonly y: number };

const DEFAULT_WINDOW = 5;
const MAX_ITERATIONS = 20;
const CONVERGE_EPSILON = 0.02;
const DET_EPSILON = 1e-9;

function intensityAt(img: GrayImage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
  return img.data[y * img.width + x] ?? 0;
}

function gradientAt(img: GrayImage, x: number, y: number): Point {
  return {
    x: (intensityAt(img, x + 1, y) - intensityAt(img, x - 1, y)) / 2,
    y: (intensityAt(img, x, y + 1) - intensityAt(img, x, y - 1)) / 2,
  };
}

/**
 * Refine an approximate corner to sub-pixel accuracy. Returns the refined point,
 * or `initial` unchanged when the window is featureless (ill-conditioned).
 */
export function refineCornerSubpixel(
  img: GrayImage,
  initial: Point,
  window = DEFAULT_WINDOW,
): Point {
  const sigma2 = ((window + 1) * (window + 1)) / 2;
  let q = initial;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const next = solveStep(img, q, window, sigma2);
    if (next === null) return q;
    if (Math.hypot(next.x - q.x, next.y - q.y) < CONVERGE_EPSILON) return next;
    q = next;
  }
  return q;
}

function solveStep(img: GrayImage, q: Point, window: number, sigma2: number): Point | null {
  const cx = Math.round(q.x);
  const cy = Math.round(q.y);
  let gxx = 0;
  let gxy = 0;
  let gyy = 0;
  let bx = 0;
  let by = 0;
  for (let dy = -window; dy <= window; dy += 1) {
    for (let dx = -window; dx <= window; dx += 1) {
      const px = cx + dx;
      const py = cy + dy;
      const g = gradientAt(img, px, py);
      const weight = Math.exp(-(dx * dx + dy * dy) / (2 * sigma2));
      const wxx = g.x * g.x * weight;
      const wxy = g.x * g.y * weight;
      const wyy = g.y * g.y * weight;
      gxx += wxx;
      gxy += wxy;
      gyy += wyy;
      bx += wxx * px + wxy * py;
      by += wxy * px + wyy * py;
    }
  }
  const det = gxx * gyy - gxy * gxy;
  if (Math.abs(det) < DET_EPSILON) return null;
  return { x: (gyy * bx - gxy * by) / det, y: (gxx * by - gxy * bx) / det };
}
