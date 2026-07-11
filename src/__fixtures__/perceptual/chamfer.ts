// Two-pass 1 / √2 chamfer distance transform over a binary mask: distance
// (px) from every pixel to the nearest ink pixel. Shared by the perceptual
// scorers (reference-pair loop, apex-fidelity invariant); accurate to a few
// percent, which is enough to rank engine iterations and gate invariants.

import type { Mask } from './rasterize';

const DIAGONAL_STEP = Math.SQRT2;

export function chamferDistance(mask: Mask): Float32Array {
  const { width, height, data } = mask;
  const dist = new Float32Array(width * height).fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < data.length; i += 1) if ((data[i] ?? 0) === 1) dist[i] = 0;
  chamferForwardPass(dist, width, height);
  chamferBackwardPass(dist, width, height);
  return dist;
}

function chamferForwardPass(dist: Float32Array, width: number, height: number): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      let d = dist[i] ?? Number.POSITIVE_INFINITY;
      if (x > 0) d = relaxed(d, dist, i - 1, 1);
      if (y > 0) d = relaxed(d, dist, i - width, 1);
      if (x > 0 && y > 0) d = relaxed(d, dist, i - width - 1, DIAGONAL_STEP);
      if (x < width - 1 && y > 0) d = relaxed(d, dist, i - width + 1, DIAGONAL_STEP);
      dist[i] = d;
    }
  }
}

function chamferBackwardPass(dist: Float32Array, width: number, height: number): void {
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      let d = dist[i] ?? Number.POSITIVE_INFINITY;
      if (x < width - 1) d = relaxed(d, dist, i + 1, 1);
      if (y < height - 1) d = relaxed(d, dist, i + width, 1);
      if (x < width - 1 && y < height - 1) d = relaxed(d, dist, i + width + 1, DIAGONAL_STEP);
      if (x > 0 && y < height - 1) d = relaxed(d, dist, i + width - 1, DIAGONAL_STEP);
      dist[i] = d;
    }
  }
}

function relaxed(d: number, dist: Float32Array, neighbour: number, step: number): number {
  return Math.min(d, (dist[neighbour] ?? Number.POSITIVE_INFINITY) + step);
}
