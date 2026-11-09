// The exact surface of a height-map relief for relief CAM (ADR-580 Amendment 2).
//
// A height map's pixels are samples of its surface. Relief CAM's cells held the
// highest pixel under each cell, so when a cell is wider than a pixel the cell
// rose above every slope by up to (cell + pixel) times the gradient, and a ball
// finishing a 42 degree slope stood off it by a median 0.14 mm at the default
// 0.025 mm scallop. The same map carved at one cell per pixel is carved on the
// surface through the pixel centres. This module hands relief CAM that surface
// whatever the cell size, as ADR-580 does for an STL: each cell reads it at its
// centre, and `Heightmap.exactSurface` carries it as two triangles per quad of
// pixel centres in the map's own millimetre frame, which the mesh contact field
// (heightmap-mesh-contact.ts) solves the cutter against, so detail narrower
// than a cell still lifts the tip.
//
// Each quad takes the diagonal whose midpoint stands higher. That triangulation
// lies on or above the other one everywhere (their difference is linear on each
// quarter of the quad and vanishes at the corners), so it is the upper envelope
// of both, as ADR-412's grid contact field uses, and it bounds the bilinear patch
// through the same four samples from above. A half-pixel border carries each edge
// pixel's value out to the relief's edge, as that pixel's footprint did.

import { partialCellCenter, type PartialCellGrid } from '../grid';
import type { HeightmapExactSurface } from './heightmap';
import type { ReliefHeightfield } from '../scene/relief';

// 1024 x 1024 pixels: 2.1M triangles, 151 MB of Float64 coordinates. A larger
// map keeps the highest-pixel cells (ADR-412 Amendment 1), as before.
export const MAX_EXACT_HEIGHTFIELD_QUADS = 1024 * 1024;

const FLOATS_PER_TRIANGLE = 9;
const POSITION_EPSILON = 1e-9;

type Axis = {
  // Vertex positions in millimetres, and the source pixel each vertex reads.
  readonly mm: Float64Array;
  readonly pixels: ReadonlyArray<number>;
};

type Lattice = {
  readonly columns: Axis;
  readonly rows: Axis;
  readonly z: Float64Array;
};

export type HeightfieldExactSurfaceResult = {
  readonly exactSurface: HeightmapExactSurface;
  readonly depth: Float32Array;
};

/**
 * The triangulated pixel-centre surface of `source` over `grid` (millimetres
 * from the map's min corner, y down as rows run) and its depth at every cell
 * centre, or undefined when it exceeds the budget or does not fit in memory.
 * `depthAt` reads one source pixel's depth.
 */
export function heightfieldExactSurface(
  source: ReliefHeightfield,
  grid: PartialCellGrid,
  depthAt: (sx: number, sy: number) => number,
): HeightfieldExactSurfaceResult | undefined {
  const { crop } = source.mapping;
  const columns = axisVertices(crop.x, crop.width, source.width, grid.widthMm);
  const rows = axisVertices(crop.y, crop.height, source.height, grid.heightMm);
  const quads = (columns.pixels.length - 1) * (rows.pixels.length - 1);
  if (quads < 1 || quads > MAX_EXACT_HEIGHTFIELD_QUADS) return undefined;
  let triangles: Float64Array;
  let depth: Float32Array;
  try {
    triangles = new Float64Array(quads * 2 * FLOATS_PER_TRIANGLE);
    depth = new Float32Array(grid.widthCells * grid.heightCells);
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
  const width = columns.pixels.length;
  const z = new Float64Array(width * rows.pixels.length);
  rows.pixels.forEach((sy, r) => {
    columns.pixels.forEach((sx, c) => {
      z[r * width + c] = depthAt(sx, sy);
    });
  });
  const lattice: Lattice = { columns, rows, z };
  const used = writeTriangles(lattice, triangles);
  if (used < triangles.length) triangles = triangles.slice(0, used);
  for (let j = 0; j < grid.heightCells; j += 1) {
    const y = partialCellCenter(grid, 'y', j);
    for (let i = 0; i < grid.widthCells; i += 1) {
      depth[j * grid.widthCells + i] = latticeDepthAt(lattice, partialCellCenter(grid, 'x', i), y);
    }
  }
  return { exactSurface: { triangles }, depth };
}

// Writes the triangles and returns how many values it wrote.
function writeTriangles(lattice: Lattice, triangles: Float64Array): number {
  const { columns, rows, z } = lattice;
  const width = columns.pixels.length;
  let at = 0;
  // Two triangles, each three (column, row) vertices.
  const put = (vertices: ReadonlyArray<readonly [number, number]>): void => {
    for (const [c, r] of vertices) {
      triangles[at] = columns.mm[c] ?? 0;
      triangles[at + 1] = rows.mm[r] ?? 0;
      triangles[at + 2] = z[r * width + c] ?? 0;
      at += 3;
    }
  };
  for (let r = 0; r + 1 < rows.pixels.length; r += 1) {
    for (let c = 0; c + 1 < width; c += 1) {
      const end = flatRunEnd(lattice, c, r);
      const a = [c, r] as const;
      const d = [end, r + 1] as const;
      if (end > c + 1) {
        // A level run of quads is one rectangle: the same surface, fewer edges.
        put([a, [end, r], d, a, d, [c, r + 1]]);
        c = end - 1;
      } else if (ridgeOnMainDiagonal(lattice, c, r)) {
        put([a, [c + 1, r], d, a, d, [c, r + 1]]);
      } else {
        put([a, [c + 1, r], [c, r + 1], [c + 1, r], d, [c, r + 1]]);
      }
    }
  }
  return at;
}

// The column where the run of level quads starting at (c, r) ends: c + 1 when
// the quad at (c, r) is not level.
function flatRunEnd(lattice: Lattice, c: number, r: number): number {
  const { z } = lattice;
  const width = lattice.columns.pixels.length;
  const level = z[r * width + c];
  let end = c;
  while (
    end + 1 < width &&
    z[r * width + end + 1] === level &&
    z[(r + 1) * width + end] === level &&
    z[(r + 1) * width + end + 1] === level &&
    z[r * width + end] === level
  ) {
    end += 1;
  }
  return Math.max(end, c + 1);
}

// True when the quad at (c, r) splits along its (c, r)-(c + 1, r + 1) diagonal.
function ridgeOnMainDiagonal(lattice: Lattice, c: number, r: number): boolean {
  const { z } = lattice;
  const width = lattice.columns.pixels.length;
  const za = z[r * width + c] ?? 0;
  const zb = z[r * width + c + 1] ?? 0;
  const zc = z[(r + 1) * width + c] ?? 0;
  const zd = z[(r + 1) * width + c + 1] ?? 0;
  return za + zd >= zb + zc;
}

// The triangulated surface's depth at (x, y) millimetres inside the map.
function latticeDepthAt(lattice: Lattice, x: number, y: number): number {
  const { columns, rows, z } = lattice;
  const width = columns.pixels.length;
  const c = intervalOf(columns.mm, x);
  const r = intervalOf(rows.mm, y);
  const u = fraction(columns.mm, c, x);
  const v = fraction(rows.mm, r, y);
  const za = z[r * width + c] ?? 0;
  const zb = z[r * width + c + 1] ?? 0;
  const zc = z[(r + 1) * width + c] ?? 0;
  const zd = z[(r + 1) * width + c + 1] ?? 0;
  if (ridgeOnMainDiagonal(lattice, c, r)) {
    return u >= v ? za + u * (zb - za) + v * (zd - zb) : za + v * (zc - za) + u * (zd - zc);
  }
  return u + v <= 1
    ? za + u * (zb - za) + v * (zc - za)
    : zd + (1 - u) * (zc - zd) + (1 - v) * (zb - zd);
}

function intervalOf(positions: Float64Array, value: number): number {
  let low = 0;
  let high = positions.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((positions[middle] ?? 0) <= value) low = middle;
    else high = middle - 1;
  }
  return low;
}

function fraction(positions: Float64Array, index: number, value: number): number {
  const a = positions[index] ?? 0;
  const b = positions[index + 1] ?? a;
  return b === a ? 0 : Math.min(1, Math.max(0, (value - a) / (b - a)));
}

// The relief's two edges plus every pixel centre strictly between them, in
// millimetres. An edge vertex reads the pixel whose footprint holds it.
function axisVertices(cropStart: number, cropSize: number, size: number, extentMm: number): Axis {
  const start = cropStart * size;
  const end = (cropStart + cropSize) * size;
  const first = clampPixel(Math.floor(start + POSITION_EPSILON), size);
  const last = clampPixel(Math.ceil(end - POSITION_EPSILON) - 1, size);
  const positions = [start];
  const pixels = [first];
  for (let pixel = first; pixel <= last; pixel += 1) {
    const centre = pixel + 0.5;
    if (centre - start <= POSITION_EPSILON || end - centre <= POSITION_EPSILON) continue;
    positions.push(centre);
    pixels.push(pixel);
  }
  positions.push(end);
  pixels.push(last);
  const mm = Float64Array.from(positions, (s) => ((s / size - cropStart) / cropSize) * extentMm);
  return { mm, pixels };
}

function clampPixel(index: number, size: number): number {
  return Math.max(0, Math.min(size - 1, index));
}
