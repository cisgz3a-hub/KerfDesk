// meshToHeightmap — sample a triangle mesh into a carveable heightmap
// (Phase H.4, ADR-098). The mesh's XY bounds scale uniformly to the target
// width (height follows the aspect ratio); its Z range normalizes to
// [−reliefDepthMm, 0] with the mesh's highest point at the stock top.
// Cells no triangle covers are the relief "background": 'floor' (default)
// carves them away to −reliefDepthMm so the model stands proud; 'top'
// leaves them at stock height.
//
// Pure and deterministic: triangles in file order, max-Z accumulation is
// order-independent, indexed loops only.

import { DEFAULT_HEIGHTMAP_CELL_MM, heightmapCellSize, type Heightmap } from './heightmap';
import { meshBounds, FLOATS_PER_TRIANGLE, type TriangleMesh } from './triangle-mesh';
import { rasterizeTriangleMaxZ, type RasterTarget } from './triangle-raster';

export type MeshHeightmapOptions = {
  readonly targetWidthMm: number;
  readonly reliefDepthMm: number;
  readonly mmPerCell?: number;
  readonly emptyCells?: 'floor' | 'top';
};

export type MeshHeightmapResult =
  | {
      readonly kind: 'ok';
      readonly heightmap: Heightmap;
      readonly widthMm: number;
      readonly heightMm: number;
    }
  | { readonly kind: 'error'; readonly reason: string };

const MIN_EXTENT = 1e-9;

export function meshToHeightmap(
  mesh: TriangleMesh,
  options: MeshHeightmapOptions,
): MeshHeightmapResult {
  const bounds = meshBounds(mesh);
  if (bounds === null) return { kind: 'error', reason: 'Mesh has no triangles.' };
  const xExtent = bounds.maxX - bounds.minX;
  const yExtent = bounds.maxY - bounds.minY;
  if (xExtent < MIN_EXTENT || yExtent < MIN_EXTENT) {
    return { kind: 'error', reason: 'Mesh is flat in X or Y — nothing to carve.' };
  }
  if (!Number.isFinite(xExtent) || !Number.isFinite(yExtent)) {
    return { kind: 'error', reason: 'Mesh bounds must be finite.' };
  }
  if (
    !Number.isFinite(options.targetWidthMm) ||
    !Number.isFinite(options.reliefDepthMm) ||
    options.targetWidthMm <= 0 ||
    options.reliefDepthMm <= 0
  ) {
    return {
      kind: 'error',
      reason: 'Target width and relief depth must be finite positive numbers.',
    };
  }

  const widthMm = options.targetWidthMm;
  const heightMm = (yExtent / xExtent) * widthMm;
  const size = heightmapCellSize(widthMm, heightMm, options.mmPerCell ?? DEFAULT_HEIGHTMAP_CELL_MM);
  if (size.kind === 'error') return size;
  const { mmPerCell } = size;
  const widthCells = Math.max(1, Math.ceil(widthMm / mmPerCell));
  const heightCells = Math.max(1, Math.ceil(heightMm / mmPerCell));

  const target: RasterTarget = {
    widthCells,
    heightCells,
    maxZ: new Float32Array(widthCells * heightCells).fill(Number.NEGATIVE_INFINITY),
  };
  rasterizeMesh(target, mesh, bounds, widthCells / xExtent, heightCells / yExtent);
  const depth = normalizeDepths(target.maxZ, bounds, options);
  return {
    kind: 'ok',
    heightmap: { widthCells, heightCells, mmPerCell, depth },
    widthMm,
    heightMm,
  };
}

function rasterizeMesh(
  target: RasterTarget,
  mesh: TriangleMesh,
  bounds: NonNullable<ReturnType<typeof meshBounds>>,
  cellsPerModelX: number,
  cellsPerModelY: number,
): void {
  const p = mesh.positions;
  for (let t = 0; t + FLOATS_PER_TRIANGLE <= p.length; t += FLOATS_PER_TRIANGLE) {
    rasterizeTriangleMaxZ(
      target,
      ((p[t] ?? 0) - bounds.minX) * cellsPerModelX,
      ((p[t + 1] ?? 0) - bounds.minY) * cellsPerModelY,
      p[t + 2] ?? 0,
      ((p[t + 3] ?? 0) - bounds.minX) * cellsPerModelX,
      ((p[t + 4] ?? 0) - bounds.minY) * cellsPerModelY,
      p[t + 5] ?? 0,
      ((p[t + 6] ?? 0) - bounds.minX) * cellsPerModelX,
      ((p[t + 7] ?? 0) - bounds.minY) * cellsPerModelY,
      p[t + 8] ?? 0,
    );
  }
}

function normalizeDepths(
  maxZ: Float32Array,
  bounds: NonNullable<ReturnType<typeof meshBounds>>,
  options: MeshHeightmapOptions,
): Float32Array {
  const zExtent = bounds.maxZ - bounds.minZ;
  const scale = zExtent < MIN_EXTENT ? 0 : options.reliefDepthMm / zExtent;
  const emptyDepth = (options.emptyCells ?? 'floor') === 'floor' ? -options.reliefDepthMm : 0;
  const depth = new Float32Array(maxZ.length);
  for (let i = 0; i < maxZ.length; i += 1) {
    const z = maxZ[i] ?? Number.NEGATIVE_INFINITY;
    depth[i] = z === Number.NEGATIVE_INFINITY ? emptyDepth : (z - bounds.maxZ) * scale;
  }
  return depth;
}
