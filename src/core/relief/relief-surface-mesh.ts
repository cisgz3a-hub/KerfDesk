// reliefSurfaceMesh — heightmap → plain vertex/index arrays for the 3D
// relief viewer (ADR-102). PURE: returns Float32Array/Uint32Array only, so
// the viewer geometry is testable without WebGL; three.js consumes these at
// the UI boundary (src/ui/relief-viewer/) and computes shading normals
// itself. One vertex per heightmap cell center, two triangles per cell
// quad; Y is the heightmap row axis and Z is depth (0 at the stock top,
// −reliefDepthMm at the floor).

import type { Heightmap } from './heightmap';

export type ReliefSurfaceMesh = {
  // x0,y0,z0, x1,y1,z1, ... — millimeters, heightmap-local frame.
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly widthMm: number;
  readonly heightMm: number;
};

export type ReliefSurfaceMeshWithNormals = ReliefSurfaceMesh & {
  // Authored for the viewer's Y-reflected presentation transform. Attaching
  // these before BufferGeometry.scale(1, -1, 1) produces the same normals
  // computeVertexNormals() produced after that reflection, without making the
  // browser thread walk every triangle.
  readonly normals: Float32Array;
};

const FLOATS_PER_VERTEX = 3;
const INDICES_PER_CELL_QUAD = 6;

export function reliefSurfaceMesh(map: Heightmap): ReliefSurfaceMesh {
  const { widthCells, heightCells, mmPerCell } = map;
  const positions = new Float32Array(widthCells * heightCells * FLOATS_PER_VERTEX);
  for (let row = 0; row < heightCells; row += 1) {
    for (let col = 0; col < widthCells; col += 1) {
      const vertex = (row * widthCells + col) * FLOATS_PER_VERTEX;
      positions[vertex] = (col + 0.5) * mmPerCell;
      positions[vertex + 1] = (row + 0.5) * mmPerCell;
      positions[vertex + 2] = map.depth[row * widthCells + col] ?? 0;
    }
  }
  const quadCols = Math.max(0, widthCells - 1);
  const quadRows = Math.max(0, heightCells - 1);
  const indices = new Uint32Array(includedQuadCount(map) * INDICES_PER_CELL_QUAD);
  let write = 0;
  for (let row = 0; row < quadRows; row += 1) {
    for (let col = 0; col < quadCols; col += 1) {
      const a = row * widthCells + col;
      const b = a + 1;
      const c = a + widthCells;
      const d = c + 1;
      if (!quadIncluded(map, a, b, c, d)) continue;
      indices[write] = a;
      indices[write + 1] = c;
      indices[write + 2] = b;
      indices[write + 3] = b;
      indices[write + 4] = c;
      indices[write + 5] = d;
      write += INDICES_PER_CELL_QUAD;
    }
  }
  return {
    positions,
    indices,
    widthMm: widthCells * mmPerCell,
    heightMm: heightCells * mmPerCell,
  };
}

function includedQuadCount(map: Heightmap): number {
  const quadCols = Math.max(0, map.widthCells - 1);
  const quadRows = Math.max(0, map.heightCells - 1);
  if (map.inclusion === undefined) return quadCols * quadRows;
  let count = 0;
  for (let row = 0; row < quadRows; row += 1) {
    for (let col = 0; col < quadCols; col += 1) {
      const a = row * map.widthCells + col;
      if (quadIncluded(map, a, a + 1, a + map.widthCells, a + map.widthCells + 1)) count += 1;
    }
  }
  return count;
}

function quadIncluded(map: Heightmap, a: number, b: number, c: number, d: number): boolean {
  const inclusion = map.inclusion;
  return (
    inclusion === undefined ||
    (inclusion[a] !== 0 && inclusion[b] !== 0 && inclusion[c] !== 0 && inclusion[d] !== 0)
  );
}

/**
 * Builds the smooth relief mesh plus the exact normals its viewer reflection
 * needs. Pure typed-array work so costly normal accumulation can run in a
 * Worker before Three.js receives the presentation buffers.
 */
export function reliefSurfaceMeshWithNormals(map: Heightmap): ReliefSurfaceMeshWithNormals {
  const mesh = reliefSurfaceMesh(map);
  return { ...mesh, normals: reflectedViewerInputNormals(mesh) };
}

// Mirrors THREE.BufferGeometry.computeVertexNormals for indexed geometry.
// The viewer reflects Y after attributes are attached. A reflection reverses
// winding, so the pre-transform normal must be the negative of the normal in
// the heightmap-local frame; Three's normal matrix then produces exactly the
// post-reflection result the old main-thread path calculated.
function reflectedViewerInputNormals(mesh: ReliefSurfaceMesh): Float32Array {
  const normals = new Float32Array(mesh.positions.length);
  const positions = mesh.positions;
  const indices = mesh.indices;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = numericAt(indices, offset) * FLOATS_PER_VERTEX;
    const b = numericAt(indices, offset + 1) * FLOATS_PER_VERTEX;
    const c = numericAt(indices, offset + 2) * FLOATS_PER_VERTEX;
    const cbX = numericAt(positions, c) - numericAt(positions, b);
    const cbY = numericAt(positions, c + 1) - numericAt(positions, b + 1);
    const cbZ = numericAt(positions, c + 2) - numericAt(positions, b + 2);
    const abX = numericAt(positions, a) - numericAt(positions, b);
    const abY = numericAt(positions, a + 1) - numericAt(positions, b + 1);
    const abZ = numericAt(positions, a + 2) - numericAt(positions, b + 2);
    const x = cbY * abZ - cbZ * abY;
    const y = cbZ * abX - cbX * abZ;
    const z = cbX * abY - cbY * abX;
    accumulate(normals, a, x, y, z);
    accumulate(normals, b, x, y, z);
    accumulate(normals, c, x, y, z);
  }
  for (let offset = 0; offset < normals.length; offset += FLOATS_PER_VERTEX) {
    const x = numericAt(normals, offset);
    const y = numericAt(normals, offset + 1);
    const z = numericAt(normals, offset + 2);
    const length = Math.sqrt(x * x + y * y + z * z);
    const scale = length === 0 ? 1 : -1 / length;
    normals[offset] = x * scale;
    normals[offset + 1] = y * scale;
    normals[offset + 2] = z * scale;
  }
  return normals;
}

function accumulate(normals: Float32Array, offset: number, x: number, y: number, z: number): void {
  normals[offset] = numericAt(normals, offset) + x;
  normals[offset + 1] = numericAt(normals, offset + 1) + y;
  normals[offset + 2] = numericAt(normals, offset + 2) + z;
}

function numericAt(values: ArrayLike<number>, index: number): number {
  return values[index] ?? 0;
}
