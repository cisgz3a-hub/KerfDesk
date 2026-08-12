// Triangle rasterization onto a max-Z grid (Phase H.4, ADR-098 — the
// riskiest H.4 algorithm, kept deliberately boring): per triangle, walk its
// cell bounding box; point-in-triangle by edge functions with a fixed
// top-left tie rule; Z by barycentric interpolation; cell value = MAX over
// all triangles. Max-accumulation is exactly what a 3-axis cutter can reach
// — vertical walls and undercuts collapse correctly — and it is
// order-independent, so file order never changes the result.

import {
  partialDualCoordinate,
  partialGridHasPartialCell,
  type PartialCellAxis,
  type PartialCellGrid,
} from '../grid';

export type RasterTarget = PartialCellGrid & {
  // Written in place by rasterizeTriangleMaxZ; initialize to −Infinity.
  readonly maxZ: Float32Array;
};

const SMALL_AREA_NORMALIZATION_THRESHOLD = 1e-12;

// Vertices in nominal cell coordinates (physical mm / requested pitch),
// z in model units. A terminal partial cell is sampled at its actual center.
export function rasterizeTriangleMaxZ(
  target: RasterTarget,
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  x3: number,
  y3: number,
  z3: number,
): void {
  const hasPartialX = partialGridHasPartialCell(target, 'x');
  const hasPartialY = partialGridHasPartialCell(target, 'y');
  const edgeFrame = rasterEdgeFrame(hasPartialX || hasPartialY, x1, y1, x2, y2, x3, y3);
  if (edgeFrame === null) return;
  const {
    x1: edgeX1,
    y1: edgeY1,
    x2: edgeX2,
    y2: edgeY2,
    x3: edgeX3,
    y3: edgeY3,
    area,
    scale: normalizationScale,
  } = edgeFrame;
  // Wind consistently so the edge functions share a sign.
  if (area < 0) {
    rasterizeTriangleMaxZ(target, x1, y1, z1, x3, y3, z3, x2, y2, z2);
    return;
  }
  const minCx = Math.max(0, Math.floor(Math.min(x1, x2, x3)));
  const maxCx = Math.min(target.widthCells - 1, Math.ceil(Math.max(x1, x2, x3)));
  const minCy = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
  const maxCy = Math.min(target.heightCells - 1, Math.ceil(Math.max(y1, y2, y3)));
  for (let cy = minCy; cy <= maxCy; cy += 1) {
    const sampleY = rasterSampleCoordinate(target, 'y', cy, hasPartialY);
    const py = normalizedSampleCoordinate(sampleY, y1, normalizationScale);
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      const sampleX = rasterSampleCoordinate(target, 'x', cx, hasPartialX);
      const px = normalizedSampleCoordinate(sampleX, x1, normalizationScale);
      const w1 = edgeFunction(edgeX2, edgeY2, edgeX3, edgeY3, px, py);
      const w2 = edgeFunction(edgeX3, edgeY3, edgeX1, edgeY1, px, py);
      const w3 = edgeFunction(edgeX1, edgeY1, edgeX2, edgeY2, px, py);
      if (!coversPoint(w1, edgeX2, edgeY2, edgeX3, edgeY3)) continue;
      if (!coversPoint(w2, edgeX3, edgeY3, edgeX1, edgeY1)) continue;
      if (!coversPoint(w3, edgeX1, edgeY1, edgeX2, edgeY2)) continue;
      const z = (w1 * z1 + w2 * z2 + w3 * z3) / area;
      const index = cy * target.widthCells + cx;
      if (z > (target.maxZ[index] ?? Number.NEGATIVE_INFINITY)) target.maxZ[index] = z;
    }
  }
}

type EdgeFrame = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly x3: number;
  readonly y3: number;
  readonly area: number;
  readonly scale: number | null;
};

function rasterEdgeFrame(
  hasPartialCell: boolean,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): EdgeFrame | null {
  const area = edgeFunction(x1, y1, x2, y2, x3, y3);
  if (Math.abs(area) >= SMALL_AREA_NORMALIZATION_THRESHOLD) {
    return { x1, y1, x2, y2, x3, y3, area, scale: null };
  }
  // Preserve the legacy regular-grid degeneracy boundary. Only partial-grid
  // scaling can select the translated unit frame that keeps a represented
  // nonzero triangle from disappearing by scale alone.
  return hasPartialCell ? normalizedEdgeFrame(x1, y1, x2, y2, x3, y3) : null;
}

function normalizedEdgeFrame(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): EdgeFrame | null {
  const scale = Math.max(
    Math.abs(x2 - x1),
    Math.abs(y2 - y1),
    Math.abs(x3 - x1),
    Math.abs(y3 - y1),
  );
  if (scale === 0) return null;
  const edgeX2 = (x2 - x1) / scale;
  const edgeY2 = (y2 - y1) / scale;
  const edgeX3 = (x3 - x1) / scale;
  const edgeY3 = (y3 - y1) / scale;
  const area = edgeFunction(0, 0, edgeX2, edgeY2, edgeX3, edgeY3);
  if (area === 0) return null;
  return { x1: 0, y1: 0, x2: edgeX2, y2: edgeY2, x3: edgeX3, y3: edgeY3, area, scale };
}

function normalizedSampleCoordinate(value: number, origin: number, scale: number | null): number {
  return scale === null ? value : (value - origin) / scale;
}

function rasterSampleCoordinate(
  target: RasterTarget,
  axis: PartialCellAxis,
  index: number,
  hasPartialCell: boolean,
): number {
  if (!hasPartialCell) return index + 0.5;
  const extentMm = axis === 'x' ? target.widthMm : target.heightMm;
  return extentMm / target.mmPerCell === 0
    ? index + 0.5
    : partialDualCoordinate(target, axis, index + 0.5) / target.mmPerCell;
}

function edgeFunction(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

// Top-left fill rule: a point exactly on an edge belongs to the triangle
// only when that edge is a top or left edge — adjacent triangles sharing the
// edge then claim each boundary cell exactly once, deterministically.
function coversPoint(w: number, ax: number, ay: number, bx: number, by: number): boolean {
  if (w > 0) return true;
  if (w < 0) return false;
  const isTopEdge = ay === by && bx < ax;
  const isLeftEdge = by < ay;
  return isTopEdge || isLeftEdge;
}
