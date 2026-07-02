// Triangle rasterization onto a max-Z grid (Phase H.4, ADR-094 — the
// riskiest H.4 algorithm, kept deliberately boring): per triangle, walk its
// cell bounding box; point-in-triangle by edge functions with a fixed
// top-left tie rule; Z by barycentric interpolation; cell value = MAX over
// all triangles. Max-accumulation is exactly what a 3-axis cutter can reach
// — vertical walls and undercuts collapse correctly — and it is
// order-independent, so file order never changes the result.

export type RasterTarget = {
  readonly widthCells: number;
  readonly heightCells: number;
  // Written in place by rasterizeTriangleMaxZ; initialize to −Infinity.
  readonly maxZ: Float32Array;
};

const DEGENERATE_AREA_EPS = 1e-12;

// Vertices in CELL coordinates (x right, y down), z in model units.
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
  const area = edgeFunction(x1, y1, x2, y2, x3, y3);
  if (Math.abs(area) < DEGENERATE_AREA_EPS) return;
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
    const py = cy + 0.5;
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      const px = cx + 0.5;
      const w1 = edgeFunction(x2, y2, x3, y3, px, py);
      const w2 = edgeFunction(x3, y3, x1, y1, px, py);
      const w3 = edgeFunction(x1, y1, x2, y2, px, py);
      if (!coversPoint(w1, x2, y2, x3, y3)) continue;
      if (!coversPoint(w2, x3, y3, x1, y1)) continue;
      if (!coversPoint(w3, x1, y1, x2, y2)) continue;
      const z = (w1 * z1 + w2 * z2 + w3 * z3) / area;
      const index = cy * target.widthCells + cx;
      if (z > (target.maxZ[index] ?? Number.NEGATIVE_INFINITY)) target.maxZ[index] = z;
    }
  }
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
