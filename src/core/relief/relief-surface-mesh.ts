// reliefSurfaceMesh — heightmap → plain vertex/index arrays for the 3D
// relief viewer (ADR-101). PURE: returns Float32Array/Uint32Array only, so
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
  const indices = new Uint32Array(quadCols * quadRows * INDICES_PER_CELL_QUAD);
  let write = 0;
  for (let row = 0; row < quadRows; row += 1) {
    for (let col = 0; col < quadCols; col += 1) {
      const a = row * widthCells + col;
      const b = a + 1;
      const c = a + widthCells;
      const d = c + 1;
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
