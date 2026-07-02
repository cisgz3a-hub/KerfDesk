// core/relief — 3D relief carving: mesh → heightmap → toolpaths (Phase H.4+,
// ADR-094). Public API.

export {
  FLOATS_PER_TRIANGLE,
  meshBounds,
  triangleCount,
  type MeshBounds,
  type TriangleMesh,
} from './triangle-mesh';
export {
  DEFAULT_HEIGHTMAP_CELL_MM,
  heightmapCellSize,
  heightmapDepthAt,
  MAX_HEIGHTMAP_CELLS,
  type Heightmap,
} from './heightmap';
export {
  meshToHeightmap,
  type MeshHeightmapOptions,
  type MeshHeightmapResult,
} from './mesh-to-heightmap';
export { marchingSquares } from './marching-squares';
export { dilateHeightmapByTool } from './heightmap-tool-offset';
export {
  DEFAULT_RELIEF_ALLOWANCE_MM,
  reliefRoughingPasses,
  type ReliefRoughingOptions,
} from './relief-roughing';
export { reliefSurfaceMesh, type ReliefSurfaceMesh } from './relief-surface-mesh';
