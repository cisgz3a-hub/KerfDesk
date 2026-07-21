// Mask boundary extraction for marching-ants rendering (ADR-242, F-L2).
//
// Emits closed loops of integer crack coordinates (pixel-corner space) that
// separate selected pixels (alpha >= threshold) from unselected ones. Each
// selected pixel contributes its exposed edges, oriented so selection lies to
// the left; chaining start->end then yields deterministic closed loops and
// keeps hole boundaries as their own loops. Collinear runs are merged so the
// UI strokes short polylines, with the animated dash phase applied there.

import { MASK_SELECTED_THRESHOLD, type SelectionMask } from './selection-mask';

export type OutlinePoint = { readonly x: number; readonly y: number };

export function maskOutline(mask: SelectionMask): readonly (readonly OutlinePoint[])[] {
  const edges = collectEdges(mask);
  return chainLoops(mask.width, edges);
}

function isSelected(mask: SelectionMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  return (mask.alpha[y * mask.width + x] ?? 0) >= MASK_SELECTED_THRESHOLD;
}

// Directed edges as fromCorner -> [toCorner...] in corner-index space
// (corner (x, y) has index y * (width + 1) + x). Orientation: walking an
// edge keeps the selected pixel on the LEFT, so outer loops run
// counter-clockwise in the y-down raster frame and holes run clockwise.
// A corner where two selected pixels touch diagonally carries TWO outgoing
// edges (the saddle case), hence the list values.
function collectEdges(mask: SelectionMask): Map<number, number[]> {
  const stride = mask.width + 1;
  const edges = new Map<number, number[]>();
  const add = (from: number, to: number) => {
    const list = edges.get(from);
    if (list === undefined) edges.set(from, [to]);
    else list.push(to);
  };
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (!isSelected(mask, x, y)) continue;
      const topLeft = y * stride + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;
      if (!isSelected(mask, x, y - 1)) add(topLeft, topRight);
      if (!isSelected(mask, x + 1, y)) add(topRight, bottomRight);
      if (!isSelected(mask, x, y + 1)) add(bottomRight, bottomLeft);
      if (!isSelected(mask, x - 1, y)) add(bottomLeft, topLeft);
    }
  }
  return edges;
}

// Every corner has equal in/out degree, so a greedy walk from any corner
// always closes back at its start (Hierholzer). At a saddle the two loops
// may merge into one figure-eight polyline — it strokes identically.
function chainLoops(
  maskWidth: number,
  edges: Map<number, number[]>,
): readonly (readonly OutlinePoint[])[] {
  const stride = maskWidth + 1;
  const loops: OutlinePoint[][] = [];
  const takeFrom = (corner: number): number | undefined => {
    const list = edges.get(corner);
    if (list === undefined || list.length === 0) return undefined;
    return list.pop();
  };
  // Map iteration preserves insertion order (row-major), so loop starts —
  // and therefore output — are deterministic for a given mask.
  for (const start of edges.keys()) {
    let next = takeFrom(start);
    while (next !== undefined) {
      const corners: number[] = [start];
      let current: number | undefined = next;
      while (current !== undefined && current !== start) {
        corners.push(current);
        current = takeFrom(current);
      }
      loops.push(simplifyLoop(corners, stride));
      next = takeFrom(start);
    }
  }
  return loops;
}

// Drop corners that continue in the same direction; the loop stays closed
// (first point implicitly reconnects to the last).
function simplifyLoop(corners: readonly number[], stride: number): OutlinePoint[] {
  const points: OutlinePoint[] = [];
  const count = corners.length;
  for (let i = 0; i < count; i += 1) {
    const prev = corners[(i + count - 1) % count] ?? 0;
    const here = corners[i] ?? 0;
    const next = corners[(i + 1) % count] ?? 0;
    const incoming = here - prev;
    const outgoing = next - here;
    if (incoming === outgoing) continue;
    points.push({ x: here % stride, y: Math.floor(here / stride) });
  }
  return points;
}
