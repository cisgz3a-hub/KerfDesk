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

// Neighbour to compare against per direction bucket (0 = |, 1 = /, 2 = -,
// 3 = \); the opposite neighbour is the negation, so NMS checks both sides.
const NMS_DX = [1, 1, 0, 1];
const NMS_DY = [0, -1, 1, 1];

// The 8 neighbours, for hysteresis edge-following.
const N8DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const N8DY = [-1, -1, -1, 0, 0, 1, 1, 1];

export function cannyEdges(image: RawImageData, options: CannyOptions = {}): Uint8Array {
  const gradient = computeGradient(image, options.blurSigma ?? DEFAULT_BLUR_SIGMA);
  const thinned = nonMaxSuppress(gradient);
  return hysteresis(
    thinned,
    gradient.width,
    gradient.height,
    options.lowThresholdRatio ?? DEFAULT_LOW_RATIO,
    options.highThresholdRatio ?? DEFAULT_HIGH_RATIO,
  );
}

function nonMaxSuppress(gradient: Gradient): Float32Array {
  const { mag, dir, width, height } = gradient;
  const out = new Float32Array(mag.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const d = at(dir, i);
      const dx = NMS_DX[d] ?? 1;
      const dy = NMS_DY[d] ?? 0;
      const m = at(mag, i);
      const a = at(mag, (y + dy) * width + (x + dx));
      const b = at(mag, (y - dy) * width + (x - dx));
      if (m >= a && m >= b) out[i] = m;
    }
  }
  return out;
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
