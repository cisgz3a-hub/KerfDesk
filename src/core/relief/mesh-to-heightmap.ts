// meshToHeightmap — sample a triangle mesh into a carveable heightmap
// (Phase H.4, ADR-098/ADR-289). The mesh's XY bounds first map to the target
// width (height follows the aspect ratio), then optional positive axis scales
// place that surface in square physical-mm cells. Its Z range normalizes to
// [−reliefDepthMm, 0] with the mesh's highest point at the stock top.
// Cells no triangle covers are the relief "background": 'floor' (default)
// carves them away to −reliefDepthMm so the model stands proud; 'top'
// leaves them at stock height.
//
// Sampling: 'center' (the default, for previews) reads each cell at its centre.
// Relief CAM asks for 'exact-mesh' (ADR-579): the cells are read at their
// centres too, and the map carries the mesh's triangles in its own frame, so
// the cutter is solved against the model itself rather than the samples
// (heightmap-mesh-contact.ts). 'footprint-max' (ADR-412 Amendment 1) holds each
// cell at the mesh's highest point over its whole footprint, a conservative
// bound that relief CAM used before ADR-579; under 'top' a cell whose centre no
// triangle covers still stays at stock height.
//
// Pure and deterministic: triangles in file order, max-Z accumulation is
// order-independent, indexed loops only.

import {
  partialCellCount,
  partialGridHasPartialCell,
  type PartialCellAxis,
  type PartialCellGrid,
} from '../grid';
import {
  DEFAULT_HEIGHTMAP_CELL_MM,
  heightmapCellSize,
  type Heightmap,
  type HeightmapExactSurface,
} from './heightmap';
import { meshBounds, FLOATS_PER_TRIANGLE, type TriangleMesh } from './triangle-mesh';
import { rasterizeTriangleFootprintMaxZ } from './triangle-footprint-raster';
import { rasterizeTriangleMaxZ, type RasterTarget } from './triangle-raster';

/**
 * How a cell reads the mesh: at its centre, its highest point over the whole
 * cell, or at its centre with the exact triangles attached for relief CAM.
 */
export type MeshSampling = 'center' | 'footprint-max' | 'exact-mesh';

export type MeshHeightmapOptions = {
  readonly targetWidthMm: number;
  readonly reliefDepthMm: number;
  readonly mmPerCell?: number;
  readonly emptyCells?: 'floor' | 'top';
  /** Relief CAM passes 'exact-mesh'; previews keep the 'center' default. */
  readonly sampling?: MeshSampling;
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

type ZRasterMode = 'native' | 'normalized' | 'flat-normalized';

// Where the mesh lands in the nominal cell frame, and how its Z is read.
type MeshPlacement = {
  readonly bounds: NonNullable<ReturnType<typeof meshBounds>>;
  readonly cellsPerModelX: number;
  readonly cellsPerModelY: number;
  readonly zRasterMode: ZRasterMode;
};

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
  const zRasterMode = resolveZRasterMode(bounds);
  const targetMetrics = targetSize(options, yExtent / xExtent);
  if (targetMetrics.kind === 'error') return targetMetrics;
  const { widthMm, heightMm } = targetMetrics;
  const gridResult = meshGrid(widthMm, heightMm, options.mmPerCell ?? DEFAULT_HEIGHTMAP_CELL_MM);
  if (gridResult.kind === 'error') return gridResult;
  const { grid } = gridResult;
  const placement: MeshPlacement = {
    bounds,
    cellsPerModelX: cellsPerModelUnit(grid, 'x', xExtent),
    cellsPerModelY: cellsPerModelUnit(grid, 'y', yExtent),
    zRasterMode,
  };
  const sampled = sampleMesh(mesh, grid, placement, options, runtime);
  if (sampled === null) {
    return { kind: 'error', reason: 'Relief mesh heightmap does not fit in this runtime.' };
  }
  return { kind: 'ok', heightmap: { ...grid, ...sampled }, widthMm, heightMm };
}

// The cells' depths, and for 'exact-mesh' the triangles beside them; null when
// either does not fit in memory.
function sampleMesh(
  mesh: TriangleMesh,
  grid: PartialCellGrid,
  placement: MeshPlacement,
  options: MeshHeightmapOptions,
  runtime: MeshHeightmapRuntime,
): Pick<Heightmap, 'depth' | 'exactSurface'> | null {
  const cellCount = grid.widthCells * grid.heightCells;
  const maxZ = allocateFloat32(runtime, cellCount);
  if (maxZ === null) return null;
  maxZ.fill(Number.NEGATIVE_INFINITY);
  const target: RasterTarget = { ...grid, maxZ };
  const exact = options.sampling === 'exact-mesh';
  rasterizeMesh(target, mesh, placement, exact ? 'center' : options.sampling);
  const depth = allocateFloat32(runtime, cellCount);
  if (depth === null) return null;
  keepCenterBackground(target, depth, mesh, placement, options);
  const exactSurface = exact ? exactMeshSurface(mesh, placement, grid, maxZ, options) : undefined;
  if (exactSurface === null) return null;
  normalizeDepths(maxZ, depth, placement.bounds, options, placement.zRasterMode);
  return exactSurface === undefined ? { depth } : { depth, exactSurface };
}

// The mesh in the map's own frame, mapped exactly as the rasterizer maps it:
// x and y through the nominal cell frame into millimetres, z through the same
// depth normalization the samples take. Null when it does not fit in memory.
function exactMeshSurface(
  mesh: TriangleMesh,
  placement: MeshPlacement,
  grid: PartialCellGrid,
  centreMaxZ: Float32Array,
  options: MeshHeightmapOptions,
): HeightmapExactSurface | null {
  const p = mesh.positions;
  const vertices = Math.floor(p.length / FLOATS_PER_TRIANGLE) * 3;
  let triangles: Float64Array;
  try {
    triangles = new Float64Array(vertices * 3);
  } catch (error) {
    if (isRangeError(error)) return null;
    throw error;
  }
  const { bounds, cellsPerModelX, cellsPerModelY, zRasterMode } = placement;
  const zExtent = bounds.maxZ - bounds.minZ;
  const scale = zExtent < MIN_EXTENT ? 0 : options.reliefDepthMm / zExtent;
  const xMm = cellsPerModelX * grid.mmPerCell;
  const yMm = cellsPerModelY * grid.mmPerCell;
  for (let v = 0; v < vertices; v += 1) {
    const at = v * 3;
    triangles[at] = ((p[at] ?? 0) - bounds.minX) * xMm;
    triangles[at + 1] = ((p[at + 1] ?? 0) - bounds.minY) * yMm;
    const z = rasterZ(p[at + 2] ?? 0, bounds, zRasterMode);
    triangles[at + 2] = normalizedDepth(z, 0, scale, options.reliefDepthMm, bounds, zRasterMode);
  }
  if (options.emptyCells !== 'top') return { triangles };
  const uncoveredTop = new Uint8Array(centreMaxZ.length);
  for (let i = 0; i < centreMaxZ.length; i += 1) {
    if (centreMaxZ[i] === Number.NEGATIVE_INFINITY) uncoveredTop[i] = 1;
  }
  return { triangles, uncoveredTop };
}

type MeshGridResult =
  | { readonly kind: 'ok'; readonly grid: PartialCellGrid }
  | { readonly kind: 'error'; readonly reason: string };

function meshGrid(widthMm: number, heightMm: number, requestedMm: number): MeshGridResult {
  const size = heightmapCellSize(widthMm, heightMm, requestedMm);
  if (size.kind === 'error') return size;
  const widthCells = partialCellCount(widthMm, size.mmPerCell);
  const heightCells = partialCellCount(heightMm, size.mmPerCell);
  if (widthCells === null || heightCells === null) {
    return { kind: 'error', reason: 'Relief mesh heightmap does not fit in this runtime.' };
  }
  return {
    kind: 'ok',
    grid: { widthCells, heightCells, widthMm, heightMm, mmPerCell: size.mmPerCell },
  };
}

function cellsPerModelUnit(
  grid: PartialCellGrid,
  axis: PartialCellAxis,
  modelExtent: number,
): number {
  const cellCount = axis === 'x' ? grid.widthCells : grid.heightCells;
  if (!partialGridHasPartialCell(grid, axis)) return cellCount / modelExtent;
  const extentMm = axis === 'x' ? grid.widthMm : grid.heightMm;
  const nominalExtent = extentMm / grid.mmPerCell;
  return (nominalExtent === 0 ? cellCount : nominalExtent) / modelExtent;
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
  placement: MeshPlacement,
  sampling: MeshSampling | undefined,
): void {
  const { bounds, cellsPerModelX, cellsPerModelY, zRasterMode } = placement;
  const rasterize =
    sampling === 'footprint-max' ? rasterizeTriangleFootprintMaxZ : rasterizeTriangleMaxZ;
  const p = mesh.positions;
  for (let t = 0; t + FLOATS_PER_TRIANGLE <= p.length; t += FLOATS_PER_TRIANGLE) {
    rasterize(
      target,
      ((p[t] ?? 0) - bounds.minX) * cellsPerModelX,
      ((p[t + 1] ?? 0) - bounds.minY) * cellsPerModelY,
      rasterZ(p[t + 2] ?? 0, bounds, zRasterMode),
      ((p[t + 3] ?? 0) - bounds.minX) * cellsPerModelX,
      ((p[t + 4] ?? 0) - bounds.minY) * cellsPerModelY,
      rasterZ(p[t + 5] ?? 0, bounds, zRasterMode),
      ((p[t + 6] ?? 0) - bounds.minX) * cellsPerModelX,
      ((p[t + 7] ?? 0) - bounds.minY) * cellsPerModelY,
      rasterZ(p[t + 8] ?? 0, bounds, zRasterMode),
    );
  }
}

// Under 'top' the background is the stock top, the highest level there is. A
// footprint-sampled cell whose centre no triangle covers keeps that background,
// decided as centre sampling decides it, instead of dropping to the part of the
// mesh it touches. The depth buffer is still free, so it holds the centre pass.
function keepCenterBackground(
  target: RasterTarget,
  scratch: Float32Array,
  mesh: TriangleMesh,
  placement: MeshPlacement,
  options: MeshHeightmapOptions,
): void {
  if (options.sampling !== 'footprint-max' || options.emptyCells !== 'top') return;
  scratch.fill(Number.NEGATIVE_INFINITY);
  rasterizeMesh({ ...target, maxZ: scratch }, mesh, placement, 'center');
  for (let i = 0; i < scratch.length; i += 1) {
    if (scratch[i] === Number.NEGATIVE_INFINITY) target.maxZ[i] = Number.NEGATIVE_INFINITY;
  }
}

function normalizeDepths(
  maxZ: Float32Array,
  depth: Float32Array,
  bounds: NonNullable<ReturnType<typeof meshBounds>>,
  options: MeshHeightmapOptions,
  zRasterMode: ZRasterMode,
): void {
  const zExtent = bounds.maxZ - bounds.minZ;
  const scale = zExtent < MIN_EXTENT ? 0 : options.reliefDepthMm / zExtent;
  const emptyDepth = (options.emptyCells ?? 'floor') === 'floor' ? -options.reliefDepthMm : 0;
  for (let i = 0; i < maxZ.length; i += 1) {
    const z = maxZ[i] ?? Number.NEGATIVE_INFINITY;
    depth[i] = normalizedDepth(z, emptyDepth, scale, options.reliefDepthMm, bounds, zRasterMode);
  }
}

function resolveZRasterMode(bounds: NonNullable<ReturnType<typeof meshBounds>>): ZRasterMode {
  if (!Number.isFinite(bounds.minZ) || !Number.isFinite(bounds.maxZ)) return 'native';
  const zExtent = bounds.maxZ - bounds.minZ;
  if (
    Number.isFinite(Math.fround(bounds.minZ)) &&
    Number.isFinite(Math.fround(bounds.maxZ)) &&
    Number.isFinite(zExtent)
  ) {
    return 'native';
  }
  return zExtent < MIN_EXTENT ? 'flat-normalized' : 'normalized';
}

function rasterZ(
  z: number,
  bounds: NonNullable<ReturnType<typeof meshBounds>>,
  mode: ZRasterMode,
): number {
  if (mode === 'native') return z;
  if (mode === 'flat-normalized') return 0;
  const scale = Math.max(Math.abs(bounds.minZ), Math.abs(bounds.maxZ));
  if (scale === 0) return 0;
  const normalizedMin = bounds.minZ / scale;
  const normalizedSpan = bounds.maxZ / scale - normalizedMin;
  return normalizedSpan === 0 ? 0 : (z / scale - normalizedMin) / normalizedSpan;
}

function normalizedDepth(
  z: number,
  emptyDepth: number,
  nativeScale: number,
  reliefDepthMm: number,
  bounds: NonNullable<ReturnType<typeof meshBounds>>,
  mode: ZRasterMode,
): number {
  if (z === Number.NEGATIVE_INFINITY) return emptyDepth;
  if (mode === 'normalized') return (z - 1) * reliefDepthMm;
  if (mode === 'flat-normalized') return 0;
  return (z - bounds.maxZ) * nativeScale;
}
