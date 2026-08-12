// meshToHeightmap — sample a triangle mesh into a carveable heightmap
// (Phase H.4, ADR-098/ADR-289). The mesh's XY bounds first map to the target
// width (height follows the aspect ratio), then optional positive axis scales
// place that surface in square physical-mm cells. Its Z range normalizes to
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
  /** Positive XY scale applied before rasterization into square physical-mm cells. */
  readonly targetScaleX?: number;
  readonly targetScaleY?: number;
};

export type MeshHeightmapResult =
  | {
      readonly kind: 'ok';
      readonly heightmap: Heightmap;
      readonly widthMm: number;
      readonly heightMm: number;
    }
  | { readonly kind: 'error'; readonly reason: string };

export type MeshHeightmapRuntime = {
  readonly allocateFloat32: (length: number) => Float32Array;
};

const DEFAULT_RUNTIME: MeshHeightmapRuntime = {
  allocateFloat32: (length) => new Float32Array(length),
};

const MIN_EXTENT = 1e-9;

export function meshToHeightmap(
  mesh: TriangleMesh,
  options: MeshHeightmapOptions,
  runtime: MeshHeightmapRuntime = DEFAULT_RUNTIME,
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
  const targetMetrics = targetSize(options, yExtent / xExtent);
  if (targetMetrics.kind === 'error') return targetMetrics;
  const { widthMm, heightMm } = targetMetrics;
  const size = heightmapCellSize(widthMm, heightMm, options.mmPerCell ?? DEFAULT_HEIGHTMAP_CELL_MM);
  if (size.kind === 'error') return size;
  const { mmPerCell } = size;
  const widthCells = Math.max(1, Math.ceil(widthMm / mmPerCell));
  const heightCells = Math.max(1, Math.ceil(heightMm / mmPerCell));
  const cellCount = widthCells * heightCells;

  const maxZ = allocateFloat32(runtime, cellCount);
  if (maxZ === null) {
    return { kind: 'error', reason: 'Relief mesh heightmap does not fit in this runtime.' };
  }
  maxZ.fill(Number.NEGATIVE_INFINITY);
  const target: RasterTarget = { widthCells, heightCells, maxZ };
  rasterizeMesh(target, mesh, bounds, widthCells / xExtent, heightCells / yExtent);
  const depth = allocateFloat32(runtime, cellCount);
  if (depth === null) {
    return { kind: 'error', reason: 'Relief mesh heightmap does not fit in this runtime.' };
  }
  normalizeDepths(maxZ, depth, bounds, options);
  return {
    kind: 'ok',
    heightmap: { widthCells, heightCells, mmPerCell, depth },
    widthMm,
    heightMm,
  };
}

function allocateFloat32(runtime: MeshHeightmapRuntime, length: number): Float32Array | null {
  try {
    const allocated = runtime.allocateFloat32(length);
    return allocated.length === length ? allocated : null;
  } catch (error) {
    if (isRangeError(error)) return null;
    throw error;
  }
}

function isRangeError(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  if (Object.prototype.toString.call(error) !== '[object Error]') return false;
  const constructor = (error as { readonly constructor?: unknown }).constructor;
  return typeof constructor === 'function' && constructor.name === 'RangeError';
}

type TargetSizeResult =
  | { readonly kind: 'ok'; readonly widthMm: number; readonly heightMm: number }
  | { readonly kind: 'error'; readonly reason: string };

function targetSize(options: MeshHeightmapOptions, aspect: number): TargetSizeResult {
  if (!positiveFinite(options.targetWidthMm) || !positiveFinite(options.reliefDepthMm)) {
    return {
      kind: 'error',
      reason: 'Target width and relief depth must be finite positive numbers.',
    };
  }
  const targetScaleX = options.targetScaleX ?? 1;
  const targetScaleY = options.targetScaleY ?? 1;
  if (!positiveFinite(targetScaleX) || !positiveFinite(targetScaleY)) {
    return { kind: 'error', reason: 'Target XY scale must be finite and positive.' };
  }
  return {
    kind: 'ok',
    widthMm: options.targetWidthMm * targetScaleX,
    heightMm: aspect * options.targetWidthMm * targetScaleY,
  };
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
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
  depth: Float32Array,
  bounds: NonNullable<ReturnType<typeof meshBounds>>,
  options: MeshHeightmapOptions,
): void {
  const zExtent = bounds.maxZ - bounds.minZ;
  const scale = zExtent < MIN_EXTENT ? 0 : options.reliefDepthMm / zExtent;
  const emptyDepth = (options.emptyCells ?? 'floor') === 'floor' ? -options.reliefDepthMm : 0;
  for (let i = 0; i < maxZ.length; i += 1) {
    const z = maxZ[i] ?? Number.NEGATIVE_INFINITY;
    depth[i] = z === Number.NEGATIVE_INFINITY ? emptyDepth : (z - bounds.maxZ) * scale;
  }
}
