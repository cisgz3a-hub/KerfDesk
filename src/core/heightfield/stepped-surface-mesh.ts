// steppedSurfaceMesh — heightfield → mesh geometry with TRUE vertical walls.
//
// The smooth builder (core/relief/relief-surface-mesh.ts) emits one vertex per
// cell CENTRE and lets three compute shading normals, so a height discontinuity
// between two cells becomes a single-cell ramp with an averaged ~45° normal. On
// an organic relief that is the correct, desirable behaviour. On a CNC pocket it
// is not: a 6 mm-deep wall renders as a chamfer, and the wall is exactly the
// geometry a machinist reads depth from.
//
// This builder instead emits a flat quad per cell at that cell's own height,
// plus an explicit vertical quad wherever two adjacent cells differ. Normals are
// authored, never averaged, so a wall's normal is horizontal and a floor's is
// straight up. That is the whole difference between a pocket that looks milled
// and one that looks melted.
//
// PURE, per ADR-102 §2: returns plain typed arrays; three consumes them at the
// UI boundary. Vertex count is roughly 4-6x the smooth builder's, which is why
// callers pair it with the display downsample that is already in place.

import type { Heightmap } from '../relief';

export type SteppedSurfaceMesh = {
  // x0,y0,z0, x1,y1,z1, ... — millimetres, heightmap-local frame.
  readonly positions: Float32Array;
  // Authored per-vertex normals, parallel to `positions`. Callers must NOT call
  // computeVertexNormals() over this geometry — doing so averages the walls
  // back into ramps and undoes the entire point of this module.
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly widthMm: number;
  readonly heightMm: number;
};

const FLOATS_PER_VERTEX = 3;
const VERTICES_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

type Point3 = readonly [number, number, number];

const NORMAL_UP: Point3 = [0, 0, 1];
const NORMAL_X_POS: Point3 = [1, 0, 0];
const NORMAL_X_NEG: Point3 = [-1, 0, 0];
const NORMAL_Y_POS: Point3 = [0, 1, 0];
const NORMAL_Y_NEG: Point3 = [0, -1, 0];
const ORIGIN: Point3 = [0, 0, 0];

// Fill-as-you-go cursor over exactly-sized buffers. `quads` is the write head;
// the buffers are sized from a counting pass so nothing ever reallocates.
type MeshWriter = {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  quads: number;
};

/**
 * Builds a stepped surface mesh with authored normals from a heightfield.
 *
 * @param map Heightfield to render; `depth` is row-major, Z=0 at stock top.
 * @returns Positions, authored normals, and indices in the heightmap-local frame.
 */
export function steppedSurfaceMesh(map: Heightmap): SteppedSurfaceMesh {
  const topQuads = map.widthCells * map.heightCells;
  const writer = createWriter(topQuads + countWallQuads(map));
  writeTopFaces(writer, map);
  writeWalls(writer, map);
  return {
    positions: writer.positions,
    normals: writer.normals,
    indices: writer.indices,
    widthMm: map.widthCells * map.mmPerCell,
    heightMm: map.heightCells * map.mmPerCell,
  };
}

function depthAt(map: Heightmap, col: number, row: number): number {
  return map.depth[row * map.widthCells + col] ?? 0;
}

function createWriter(quadCount: number): MeshWriter {
  const vertexFloats = quadCount * VERTICES_PER_QUAD * FLOATS_PER_VERTEX;
  return {
    positions: new Float32Array(vertexFloats),
    normals: new Float32Array(vertexFloats),
    indices: new Uint32Array(quadCount * INDICES_PER_QUAD),
    quads: 0,
  };
}

// A wall exists on every interior edge whose two cells differ in height. Counted
// up front so the buffers can be allocated exactly once.
function countWallQuads(map: Heightmap): number {
  let walls = 0;
  for (let row = 0; row < map.heightCells; row += 1) {
    for (let col = 0; col < map.widthCells; col += 1) {
      const here = depthAt(map, col, row);
      if (col + 1 < map.widthCells && depthAt(map, col + 1, row) !== here) walls += 1;
      if (row + 1 < map.heightCells && depthAt(map, col, row + 1) !== here) walls += 1;
    }
  }
  return walls;
}

function pushQuad(writer: MeshWriter, corners: readonly Point3[], normal: Point3): void {
  const base = writer.quads * VERTICES_PER_QUAD;
  for (let i = 0; i < VERTICES_PER_QUAD; i += 1) {
    const corner = corners[i] ?? ORIGIN;
    const at = (base + i) * FLOATS_PER_VERTEX;
    writer.positions[at] = corner[0];
    writer.positions[at + 1] = corner[1];
    writer.positions[at + 2] = corner[2];
    writer.normals[at] = normal[0];
    writer.normals[at + 1] = normal[1];
    writer.normals[at + 2] = normal[2];
  }
  const index = writer.quads * INDICES_PER_QUAD;
  writer.indices[index] = base;
  writer.indices[index + 1] = base + 1;
  writer.indices[index + 2] = base + 2;
  writer.indices[index + 3] = base;
  writer.indices[index + 4] = base + 2;
  writer.indices[index + 5] = base + 3;
  writer.quads += 1;
}

// Each cell is a full-width flat quad at its own height — not a point sample at
// the centre — so the floor of a pocket is genuinely flat right up to its wall.
function writeTopFaces(writer: MeshWriter, map: Heightmap): void {
  const mm = map.mmPerCell;
  for (let row = 0; row < map.heightCells; row += 1) {
    for (let col = 0; col < map.widthCells; col += 1) {
      const z = depthAt(map, col, row);
      const x0 = col * mm;
      const y0 = row * mm;
      pushQuad(
        writer,
        [
          [x0, y0, z],
          [x0 + mm, y0, z],
          [x0 + mm, y0 + mm, z],
          [x0, y0 + mm, z],
        ],
        NORMAL_UP,
      );
    }
  }
}

function writeWalls(writer: MeshWriter, map: Heightmap): void {
  for (let row = 0; row < map.heightCells; row += 1) {
    for (let col = 0; col < map.widthCells; col += 1) {
      writeColumnWall(writer, map, col, row);
      writeRowWall(writer, map, col, row);
    }
  }
}

// Wall on the +X edge of (col,row). Corner order is chosen so the winding's
// right-hand normal agrees with the authored normal in BOTH directions, which
// keeps the mesh correct if a caller ever renders it single-sided.
function writeColumnWall(writer: MeshWriter, map: Heightmap, col: number, row: number): void {
  if (col + 1 >= map.widthCells) return;
  const here = depthAt(map, col, row);
  const next = depthAt(map, col + 1, row);
  if (here === next) return;
  const mm = map.mmPerCell;
  const x = (col + 1) * mm;
  const y0 = row * mm;
  const taller = here > next;
  const [ya, yb] = taller ? [y0, y0 + mm] : [y0 + mm, y0];
  pushQuad(
    writer,
    [
      [x, ya, Math.min(here, next)],
      [x, yb, Math.min(here, next)],
      [x, yb, Math.max(here, next)],
      [x, ya, Math.max(here, next)],
    ],
    taller ? NORMAL_X_POS : NORMAL_X_NEG,
  );
}

// Wall on the +Y edge of (col,row). The X order is reversed relative to the
// column case because the right-hand rule flips when the wall's plane does.
function writeRowWall(writer: MeshWriter, map: Heightmap, col: number, row: number): void {
  if (row + 1 >= map.heightCells) return;
  const here = depthAt(map, col, row);
  const next = depthAt(map, col, row + 1);
  if (here === next) return;
  const mm = map.mmPerCell;
  const y = (row + 1) * mm;
  const x0 = col * mm;
  const taller = here > next;
  const [xa, xb] = taller ? [x0 + mm, x0] : [x0, x0 + mm];
  pushQuad(
    writer,
    [
      [xa, y, Math.min(here, next)],
      [xb, y, Math.min(here, next)],
      [xb, y, Math.max(here, next)],
      [xa, y, Math.max(here, next)],
    ],
    taller ? NORMAL_Y_POS : NORMAL_Y_NEG,
  );
}
