// distance-transform — two-pass chamfer distance inside a mask, in
// millimetres. Feeds the v-carve preview law z = -dist / tan(tipAngle / 2)
// (ADR-271 Amendment 1 clause 4): the distance to the region boundary IS the
// groove depth, which is why the transform lives next to the carve and not in
// a generic geometry module.
//
// Chamfer 1/sqrt(2) weights overestimate a true Euclidean distance by at most
// ~4%, invisible at preview resolution and 25x cheaper than an exact EDT.

import type { CarveGrid } from './carve-input';

const OUTSIDE_DISTANCE_MM = 0;

/**
 * Distance from each inside cell to the nearest outside cell, in mm.
 * Outside cells read 0. Cells beyond the grid edge count as outside, so a
 * region cropped by the stock boundary previews shallower there, not deeper.
 */
export function insideDistanceMm(mask: Uint8Array, grid: CarveGrid): Float32Array {
  const { widthCells, heightCells, mmPerCell } = grid;
  const distance = new Float32Array(widthCells * heightCells);
  for (let index = 0; index < distance.length; index += 1) {
    distance[index] = mask[index] === 1 ? Number.POSITIVE_INFINITY : OUTSIDE_DISTANCE_MM;
  }
  const straight = mmPerCell;
  const diagonal = mmPerCell * Math.SQRT2;
  forwardPass(distance, widthCells, heightCells, straight, diagonal);
  backwardPass(distance, widthCells, heightCells, straight, diagonal);
  return distance;
}

// A neighbor's distance plus the step weight; out-of-grid neighbors count as
// outside (distance 0), so a region cropped by the stock edge stays shallow.
function throughNeighbor(
  distance: Float32Array,
  index: number,
  inGrid: boolean,
  weight: number,
): number {
  return inGrid ? (distance[index] ?? 0) + weight : weight;
}

function forwardPass(
  distance: Float32Array,
  width: number,
  height: number,
  straight: number,
  diagonal: number,
): void {
  for (let cy = 0; cy < height; cy += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      const index = cy * width + cx;
      const best = distance[index] ?? OUTSIDE_DISTANCE_MM;
      if (best === OUTSIDE_DISTANCE_MM) continue;
      distance[index] = Math.min(
        best,
        throughNeighbor(distance, index - 1, cx > 0, straight),
        throughNeighbor(distance, index - width, cy > 0, straight),
        throughNeighbor(distance, index - width - 1, cx > 0 && cy > 0, diagonal),
        throughNeighbor(distance, index - width + 1, cx < width - 1 && cy > 0, diagonal),
      );
    }
  }
}

function backwardPass(
  distance: Float32Array,
  width: number,
  height: number,
  straight: number,
  diagonal: number,
): void {
  for (let cy = height - 1; cy >= 0; cy -= 1) {
    for (let cx = width - 1; cx >= 0; cx -= 1) {
      const index = cy * width + cx;
      const best = distance[index] ?? OUTSIDE_DISTANCE_MM;
      if (best === OUTSIDE_DISTANCE_MM) continue;
      distance[index] = Math.min(
        best,
        throughNeighbor(distance, index + 1, cx < width - 1, straight),
        throughNeighbor(distance, index + width, cy < height - 1, straight),
        throughNeighbor(distance, index + width + 1, cx < width - 1 && cy < height - 1, diagonal),
        throughNeighbor(distance, index + width - 1, cx > 0 && cy < height - 1, diagonal),
      );
    }
  }
}
