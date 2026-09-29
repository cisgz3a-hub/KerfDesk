// Conservative triangle rasterization for relief CAM (ADR-412 Amendment 1).
// Each cell takes the highest point of every triangle over the cell's whole
// closed footprint instead of the height at its centre, so a raised detail
// narrower than a cell still lifts every cell it touches, as one coarse cell
// of a depth-map relief already takes the maximum of its source pixels
// (heightfield-to-heightmap.ts). Z is linear on a triangle, so its maximum over
// triangle ∩ cell lies at a vertex of that convex polygon: a triangle vertex
// inside the cell, a cell corner inside the triangle, or a point where a
// triangle edge crosses the cell boundary. Clipping each edge to the cell finds
// the first and last kinds; the corners are tested against the triangle.
//
// Max-accumulation keeps the result independent of the order of the triangles.
// A closed footprint needs no tie rule: a triangle that only touches a cell's
// boundary still lifts it, which can only keep the cutter higher. A triangle
// with (almost) no plan area, such as a vertical wall, lifts the cells under
// its edges. Footprints are unit squares of the nominal cell frame the mesh is
// mapped into; a short terminal cell is that square cut at the mesh's own
// extent, which no triangle crosses, so the unit square reads it exactly.

import type { RasterTarget } from './triangle-raster';

// Below this doubled plan area (in nominal cells, the same measure the centre
// rasterizer uses) a triangle is read through its edges alone: floating point
// cannot place a corner inside it reliably, and its edges bound it anyway.
const MIN_INTERIOR_AREA = 1e-12;
// Corner bits of the cell whose low corner is (x, y): 1 = (x, y),
// 2 = (x + 1, y), 4 = (x, y + 1), 8 = (x + 1, y + 1).
const ALL_CORNERS = 15;

type FootprintTriangle = {
  readonly x1: number;
  readonly y1: number;
  readonly z1: number;
  readonly x2: number;
  readonly y2: number;
  readonly z2: number;
  readonly x3: number;
  readonly y3: number;
  readonly z3: number;
  readonly zMax: number;
  // True when the plan area is large enough to test corners against it; the
  // vertices are then wound so the interior lies left of every edge.
  readonly interior: boolean;
  readonly slopeX: number;
  readonly slopeY: number;
};

// Liang–Barsky parameter span of the edge being clipped (hot path scratch).
const span = { start: 0, end: 1 };

/**
 * Raise every cell the triangle touches to the triangle's highest point over
 * that cell. Vertices are in nominal cell coordinates, z in model units;
 * `target.maxZ` starts at −Infinity.
 */
export function rasterizeTriangleFootprintMaxZ(
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
  // Cell i covers [i, i + 1]; the closed footprints touching [min, max].
  const minCx = Math.max(0, Math.ceil(Math.min(x1, x2, x3)) - 1);
  const maxCx = Math.min(target.widthCells - 1, Math.floor(Math.max(x1, x2, x3)));
  const minCy = Math.max(0, Math.ceil(Math.min(y1, y2, y3)) - 1);
  const maxCy = Math.min(target.heightCells - 1, Math.floor(Math.max(y1, y2, y3)));
  if (!(minCx <= maxCx && minCy <= maxCy)) return;
  const triangle = footprintTriangle(x1, y1, z1, x2, y2, z2, x3, y3, z3);
  for (let cy = minCy; cy <= maxCy; cy += 1) {
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      const z = triangleMaxOverCell(triangle, cx, cy);
      const index = cy * target.widthCells + cx;
      if (z > (target.maxZ[index] ?? Number.NEGATIVE_INFINITY)) target.maxZ[index] = z;
    }
  }
}

function footprintTriangle(
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number,
  x3: number,
  y3: number,
  z3: number,
): FootprintTriangle {
  const area = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
  if (area < 0) return footprintTriangle(x1, y1, z1, x3, y3, z3, x2, y2, z2);
  const interior = area >= MIN_INTERIOR_AREA;
  return {
    x1,
    y1,
    z1,
    x2,
    y2,
    z2,
    x3,
    y3,
    z3,
    zMax: Math.max(z1, z2, z3),
    interior,
    // The plane z = z1 + slopeX (x - x1) + slopeY (y - y1) through all three.
    slopeX: interior ? ((z2 - z1) * (y3 - y1) - (z3 - z1) * (y2 - y1)) / area : 0,
    slopeY: interior ? ((x2 - x1) * (z3 - z1) - (x3 - x1) * (z2 - z1)) / area : 0,
  };
}

// The triangle's highest point over the closed unit cell whose low corner is
// (left, bottom), or −Infinity when they do not meet.
function triangleMaxOverCell(t: FootprintTriangle, left: number, bottom: number): number {
  let best = Number.NEGATIVE_INFINITY;
  if (t.interior) {
    const inside = cornersInside(t, left, bottom);
    if (inside < 0) return best;
    // The whole cell lies in the triangle: the plane peaks at a corner.
    if (inside === ALL_CORNERS) return Math.min(t.zMax, highestCornerZ(t, left, bottom));
    best = insideCornersZ(t, inside, left, bottom);
  }
  best = Math.max(
    best,
    clippedEdgeMaxZ(t.x1, t.y1, t.z1, t.x2, t.y2, t.z2, left, bottom),
    clippedEdgeMaxZ(t.x2, t.y2, t.z2, t.x3, t.y3, t.z3, left, bottom),
    clippedEdgeMaxZ(t.x3, t.y3, t.z3, t.x1, t.y1, t.z1, left, bottom),
  );
  // Rounding in the plane must not lift a cell above the triangle itself.
  return Math.min(t.zMax, best);
}

// Corner bits inside the closed triangle, or −1 when all four corners lie
// strictly outside one edge (the cell misses the triangle).
function cornersInside(t: FootprintTriangle, left: number, bottom: number): number {
  const edge1 = cornersLeftOf(t.x2, t.y2, t.x3, t.y3, left, bottom);
  const edge2 = cornersLeftOf(t.x3, t.y3, t.x1, t.y1, left, bottom);
  const edge3 = cornersLeftOf(t.x1, t.y1, t.x2, t.y2, left, bottom);
  return edge1 === 0 || edge2 === 0 || edge3 === 0 ? -1 : edge1 & edge2 & edge3;
}

// Corner bits on or left of the directed edge a→b (the same edge function as
// the centre rasterizer, evaluated at the four corners of the unit cell).
function cornersLeftOf(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  left: number,
  bottom: number,
): number {
  const ex = bx - ax;
  const ey = by - ay;
  const low = ex * (bottom - ay) - ey * (left - ax);
  const high = low + ex;
  return (
    (low >= 0 ? 1 : 0) | (low - ey >= 0 ? 2 : 0) | (high >= 0 ? 4 : 0) | (high - ey >= 0 ? 8 : 0)
  );
}

function highestCornerZ(t: FootprintTriangle, left: number, bottom: number): number {
  return planeZ(t, t.slopeX >= 0 ? left + 1 : left, t.slopeY >= 0 ? bottom + 1 : bottom);
}

function insideCornersZ(
  t: FootprintTriangle,
  inside: number,
  left: number,
  bottom: number,
): number {
  let best = Number.NEGATIVE_INFINITY;
  if ((inside & 1) !== 0) best = Math.max(best, planeZ(t, left, bottom));
  if ((inside & 2) !== 0) best = Math.max(best, planeZ(t, left + 1, bottom));
  if ((inside & 4) !== 0) best = Math.max(best, planeZ(t, left, bottom + 1));
  if ((inside & 8) !== 0) best = Math.max(best, planeZ(t, left + 1, bottom + 1));
  return best;
}

function planeZ(t: FootprintTriangle, x: number, y: number): number {
  return t.z1 + t.slopeX * (x - t.x1) + t.slopeY * (y - t.y1);
}

// The highest z of edge a→b inside the closed unit cell, or −Infinity when the
// edge misses it. Z is linear along the edge, so it peaks at an end of the
// clipped piece: a vertex inside the cell or a crossing of the cell boundary.
function clippedEdgeMaxZ(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  left: number,
  bottom: number,
): number {
  span.start = 0;
  span.end = 1;
  if (!clipAxis(ax, bx - ax, left) || !clipAxis(ay, by - ay, bottom)) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.max(edgeZ(az, bz, span.start), edgeZ(az, bz, span.end));
}

// Narrow the span to the parameters where start + t·delta lies in [low, low + 1].
function clipAxis(start: number, delta: number, low: number): boolean {
  if (delta === 0) return start >= low && start <= low + 1;
  const enter = (low - start) / delta;
  const leave = (low + 1 - start) / delta;
  span.start = Math.max(span.start, Math.min(enter, leave));
  span.end = Math.min(span.end, Math.max(enter, leave));
  return span.start <= span.end;
}

// Exact at both ends and along a level edge.
function edgeZ(az: number, bz: number, t: number): number {
  return t === 1 ? bz : az + t * (bz - az);
}
