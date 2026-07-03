// Canny edge detector (ADR-059): non-maximum suppression thins the gradient to
// 1px ridges, then double-threshold hysteresis keeps strong edges and the weak
// edges connected to them. Produces a 1px binary edge map so full-colour art
// traces as a clean line drawing (its edges) instead of a flat brightness
// silhouette. Clean-room textbook Canny (1986); no GPL/third-party code.

import { type Gradient, computeGradient } from './canny-gradient';
import type { RawImageData } from './trace-image';

export type CannyOptions = {
  readonly blurSigma?: number;
  readonly lowThresholdRatio?: number; // fraction of the max gradient
  readonly highThresholdRatio?: number;
};

const DEFAULT_BLUR_SIGMA = 1.2;
const DEFAULT_LOW_RATIO = 0.08;
const DEFAULT_HIGH_RATIO = 0.2;
// Below this peak gradient the image is treated as flat (no edges); guards a
// zero high-threshold from flagging every pixel as a strong edge.
const MIN_GRADIENT = 1e-6;

// The 8 neighbours, for hysteresis edge-following.
const N8DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const N8DY = [-1, -1, -1, 0, 0, 1, 1, 1];

const MIN_GRADIENT_LEN = 1e-12;

export type CannyField = {
  /** 1-px binary edge map after hysteresis. */
  readonly edges: Uint8Array;
  /** Non-max-suppressed gradient magnitude — the edge RIDGE including the
   *  sub-threshold stretches hysteresis dropped. Ridge-following reconnection
   *  walks this to close gaps where a weak edge really continues. */
  readonly ridgeMag: Float32Array;
  /** The hysteresis low threshold in ridgeMag units. */
  readonly lowThreshold: number;
  /** Pre-NMS gradient magnitude — sub-pixel refinement fits its peak. */
  readonly gradMag: Float32Array;
  readonly gradX: Float32Array;
  readonly gradY: Float32Array;
};

export function cannyEdges(image: RawImageData, options: CannyOptions = {}): Uint8Array {
  return cannyEdgeField(image, options).edges;
}

export function cannyEdgeField(image: RawImageData, options: CannyOptions = {}): CannyField {
  const gradient = computeGradient(image, options.blurSigma ?? DEFAULT_BLUR_SIGMA);
  const thinned = nonMaxSuppress(gradient);
  let max = 0;
  for (const v of thinned) if (v > max) max = v;
  const lowRatio = options.lowThresholdRatio ?? DEFAULT_LOW_RATIO;
  const edges = hysteresis(
    thinned,
    gradient.width,
    gradient.height,
    lowRatio,
    options.highThresholdRatio ?? DEFAULT_HIGH_RATIO,
  );
  return {
    edges,
    ridgeMag: thinned,
    lowThreshold: max * lowRatio,
    gradMag: gradient.mag,
    gradX: gradient.gradX,
    gradY: gradient.gradY,
  };
}

// Interpolating NMS: compare each pixel against the bilinear magnitude one
// step to EITHER side along its true gradient direction. Bucketed 4-way
// comparisons systematically starve ridges near ±45° (hard synthetic edges
// lose almost their whole diagonal), which fragments every traced curve.
function nonMaxSuppress(gradient: Gradient): Float32Array {
  const { mag, gradX, gradY, width, height } = gradient;
  const out = new Float32Array(mag.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const m = at(mag, i);
      if (m <= 0) continue;
      const gx = at(gradX, i);
      const gy = at(gradY, i);
      const len = Math.hypot(gx, gy);
      if (len < MIN_GRADIENT_LEN) continue;
      const ux = gx / len;
      const uy = gy / len;
      const a = bilinearMag(mag, width, height, x + ux, y + uy);
      const b = bilinearMag(mag, width, height, x - ux, y - uy);
      if (m >= a && m >= b) out[i] = m;
    }
  }
  return out;
}

function bilinearMag(
  mag: Float32Array,
  width: number,
  height: number,
  fx: number,
  fy: number,
): number {
  const cx = Math.min(Math.max(fx, 0), width - 1);
  const cy = Math.min(Math.max(fy, 0), height - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = cx - x0;
  const ty = cy - y0;
  const top = at(mag, y0 * width + x0) * (1 - tx) + at(mag, y0 * width + x1) * tx;
  const bottom = at(mag, y1 * width + x0) * (1 - tx) + at(mag, y1 * width + x1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function hysteresis(
  mag: Float32Array,
  width: number,
  height: number,
  lowRatio: number,
  highRatio: number,
): Uint8Array {
  const edges = new Uint8Array(mag.length);
  let max = 0;
  for (const v of mag) if (v > max) max = v;
  if (max <= MIN_GRADIENT) return edges;
  const high = max * highRatio;
  const low = max * lowRatio;
  const stack: number[] = [];
  for (let i = 0; i < mag.length; i += 1) {
    if (at(mag, i) >= high) {
      edges[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length > 0) {
    const i = stack.pop();
    if (i === undefined) break;
    growWeakNeighbours(i, edges, mag, width, height, low, stack);
  }
  return edges;
}

// From a confirmed edge pixel, promote any 8-connected neighbour whose gradient
// clears the low threshold and push it so the edge chain keeps growing.
function growWeakNeighbours(
  i: number,
  edges: Uint8Array,
  mag: Float32Array,
  width: number,
  height: number,
  low: number,
  stack: number[],
): void {
  const x = i % width;
  const y = (i - x) / width;
  for (let k = 0; k < N8DX.length; k += 1) {
    const nx = x + (N8DX[k] ?? 0);
    const ny = y + (N8DY[k] ?? 0);
    if (!inBounds(nx, ny, width, height)) continue;
    const j = ny * width + nx;
    if (edges[j] === 0 && at(mag, j) >= low) {
      edges[j] = 1;
      stack.push(j);
    }
  }
}

function inBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

function at(arr: Float32Array | Uint8Array, i: number): number {
  return arr[i] ?? 0;
}
