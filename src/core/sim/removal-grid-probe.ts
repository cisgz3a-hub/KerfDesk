// probeRemovalGrid — how deep the cut is at a point.
//
// The 3D viewport raycasts the machined surface and needs a number to show
// under the cursor. Reading the grid is the honest answer: the mesh it hit was
// built from these cells, so anything derived from the mesh instead would be a
// second, drifting source of truth.
//
// Out of bounds is a UNION ARM, not a throw and not a sentinel depth. Core
// never throws for control flow, and returning 0 for "off the stock" would be
// indistinguishable from "on the stock, uncut".
//
// PURE: a grid and a point in, a reading out.

import type { RemovalGrid } from './removal-grid';

export type RemovalGridProbe =
  | { readonly kind: 'outside' }
  // depthMm is <= 0: 0 is untouched stock, negative is material removed.
  | { readonly kind: 'inside'; readonly depthMm: number };

/**
 * Reads the cut depth at a point in the grid's own frame.
 *
 * @param grid The removal grid to sample.
 * @param point Point in the same frame the grid was stamped in, in mm.
 * @returns The depth reading, or the outside arm when the point is off-grid.
 */
export function probeRemovalGrid(
  grid: RemovalGrid,
  point: { readonly x: number; readonly y: number },
): RemovalGridProbe {
  const cx = Math.floor((point.x - grid.originX) / grid.mmPerCell);
  const cy = Math.floor((point.y - grid.originY) / grid.mmPerCell);
  if (cx < 0 || cy < 0 || cx >= grid.widthCells || cy >= grid.heightCells) {
    return { kind: 'outside' };
  }
  const depth = grid.depth[cy * grid.widthCells + cx];
  // The bounds check above makes a hole impossible, but
  // noUncheckedIndexedAccess keeps the possibility in the type, and untouched
  // stock is the truthful reading for it.
  return { kind: 'inside', depthMm: depth ?? 0 };
}
