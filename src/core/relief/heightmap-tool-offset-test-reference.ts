import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/precision';
import { partialCellCenter, partialCellEnd, partialCellStart } from '../grid';
import type { ToolKernel, ToolKernelOffset } from '../sim';
import { cuttingSurfaceDz } from '../sim/cutting-surface';
import type { Heightmap } from './heightmap';

const TOOL_DISTANCE_TOLERANCE_ULPS = 16;

export type DilationReference = {
  readonly tipDepth: Float32Array;
  readonly touchesExcluded: Uint8Array | undefined;
};

type ReferenceGeometry = 'physical' | 'regular';

type CellContext = {
  readonly map: Heightmap;
  readonly kernel: ToolKernel;
  readonly cx: number;
  readonly cy: number;
};

export function bruteForcePhysicalDilation(
  map: Heightmap,
  kernel: ToolKernel,
  allowanceMm: number,
): DilationReference {
  return referenceDilation(map, kernel, allowanceMm, 'physical');
}

export function legacyRegularDilation(
  map: Heightmap,
  kernel: ToolKernel,
  allowanceMm: number,
): DilationReference {
  return referenceDilation(map, kernel, allowanceMm, 'regular');
}

function referenceDilation(
  map: Heightmap,
  kernel: ToolKernel,
  allowanceMm: number,
  geometry: ReferenceGeometry,
): DilationReference {
  const out = new Float32Array(map.widthCells * map.heightCells);
  const outBits = new Uint32Array(out.buffer);
  const touchesExcluded =
    map.inclusion === undefined ? undefined : new Uint8Array(map.widthCells * map.heightCells);
  for (let cy = 0; cy < map.heightCells; cy += 1) {
    for (let cx = 0; cx < map.widthCells; cx += 1) {
      const center = cy * map.widthCells + cx;
      if (map.inclusion?.[center] === 0) continue;
      const context = { map, kernel, cx, cy };
      const surface = surfaceConstraint(context, geometry);
      const excluded = excludedConstraint(context, geometry, false);
      const best = Math.max(surface, excluded);
      const safe = best === Number.NEGATIVE_INFINITY ? (map.depth[center] ?? 0) : best;
      storeTipDepth(
        out,
        outBits,
        center,
        Math.min(0, safe + allowanceMm),
        map.inclusion !== undefined,
      );
      if (
        touchesExcluded !== undefined &&
        excludedConstraint(context, geometry, true) !== Number.NEGATIVE_INFINITY
      ) {
        touchesExcluded[center] = 1;
      }
    }
  }
  return { tipDepth: out, touchesExcluded };
}

function surfaceConstraint(context: CellContext, geometry: ReferenceGeometry): number {
  if (geometry === 'regular') return regularSurfaceConstraint(context);
  const { kernel } = context;
  let best = Number.NEGATIVE_INFINITY;
  for (
    let dy = -kernel.surfaceCandidateSpanCells;
    dy <= kernel.surfaceCandidateSpanCells;
    dy += 1
  ) {
    for (
      let dx = -kernel.surfaceCandidateSpanCells;
      dx <= kernel.surfaceCandidateSpanCells;
      dx += 1
    ) {
      best = Math.max(best, physicalSurfaceCandidate(context, context.cx + dx, context.cy + dy));
    }
  }
  return best;
}

function regularSurfaceConstraint(context: CellContext): number {
  const { map, kernel, cx, cy } = context;
  let best = Number.NEGATIVE_INFINITY;
  for (const offset of kernel.offsets) {
    const neighbor = cellIndex(map, cx + offset.dx, cy + offset.dy);
    if (neighbor === null || map.inclusion?.[neighbor] === 0) continue;
    best = Math.max(best, (map.depth[neighbor] ?? 0) - offset.dz);
  }
  return best;
}

function physicalSurfaceCandidate(context: CellContext, nx: number, ny: number): number {
  const { map, kernel, cx, cy } = context;
  const neighbor = cellIndex(map, nx, ny);
  if (neighbor === null || map.inclusion?.[neighbor] === 0) return Number.NEGATIVE_INFINITY;
  const distanceMm = Math.hypot(
    partialCellCenter(map, 'x', nx) - partialCellCenter(map, 'x', cx),
    partialCellCenter(map, 'y', ny) - partialCellCenter(map, 'y', cy),
  );
  if (distanceMm > kernel.radiusMm + toolDistanceTolerance(kernel)) {
    return Number.NEGATIVE_INFINITY;
  }
  const dz = cuttingSurfaceDz(kernel.tool, Math.min(kernel.radiusMm, distanceMm), kernel.radiusMm);
  return (map.depth[neighbor] ?? 0) - dz;
}

function excludedConstraint(
  context: CellContext,
  geometry: ReferenceGeometry,
  isSweep: boolean,
): number {
  if (context.map.inclusion === undefined) return Number.NEGATIVE_INFINITY;
  if (geometry === 'regular') {
    const offsets = isSweep
      ? (context.kernel.maskSweepCellOffsets ??
        context.kernel.maskCellOffsets ??
        context.kernel.offsets)
      : (context.kernel.maskCellOffsets ?? context.kernel.offsets);
    return regularExcludedConstraint(context, offsets);
  }
  const span = isSweep
    ? context.kernel.maskSweepCandidateSpanCells
    : context.kernel.maskCellCandidateSpanCells;
  const uncertainty = isSweep
    ? context.kernel.maskSweepPathUncertaintyMm
    : context.kernel.maskPathUncertaintyMm;
  return physicalExcludedConstraint(context, span, uncertainty);
}

function regularExcludedConstraint(
  context: CellContext,
  offsets: ReadonlyArray<ToolKernelOffset>,
): number {
  const { map, cx, cy } = context;
  let best = Number.NEGATIVE_INFINITY;
  for (const offset of offsets) {
    const neighbor = cellIndex(map, cx + offset.dx, cy + offset.dy);
    if (neighbor === null || map.inclusion?.[neighbor] !== 0) continue;
    best = Math.max(best, CNC_MASK_EMISSION_Z_CLEARANCE_MM - offset.dz);
  }
  return best;
}

function physicalExcludedConstraint(
  context: CellContext,
  span: number,
  uncertaintyMm: number,
): number {
  const { map, kernel, cx, cy } = context;
  const centerX = partialCellCenter(map, 'x', cx);
  const centerY = partialCellCenter(map, 'y', cy);
  let best = Number.NEGATIVE_INFINITY;
  for (let dy = -span; dy <= span; dy += 1) {
    for (let dx = -span; dx <= span; dx += 1) {
      const nx = cx + dx;
      const ny = cy + dy;
      const neighbor = cellIndex(map, nx, ny);
      if (neighbor === null || map.inclusion?.[neighbor] !== 0) continue;
      const distanceMm = Math.max(
        0,
        Math.hypot(distanceToCell(centerX, map, 'x', nx), distanceToCell(centerY, map, 'y', ny)) -
          uncertaintyMm,
      );
      if (distanceMm > kernel.radiusMm + toolDistanceTolerance(kernel)) continue;
      const dz = cuttingSurfaceDz(
        kernel.tool,
        Math.min(kernel.radiusMm, distanceMm),
        kernel.radiusMm,
      );
      best = Math.max(best, CNC_MASK_EMISSION_Z_CLEARANCE_MM - dz);
    }
  }
  return best;
}

function distanceToCell(value: number, map: Heightmap, axis: 'x' | 'y', index: number): number {
  const start = partialCellStart(map, axis, index);
  const end = partialCellEnd(map, axis, index);
  if (value < start) return start - value;
  return value > end ? value - end : 0;
}

function storeTipDepth(
  out: Float32Array,
  outBits: Uint32Array,
  index: number,
  value: number,
  roundTowardStock: boolean,
): void {
  out[index] = value;
  if (!roundTowardStock || (out[index] ?? 0) >= value) return;
  outBits[index] = (outBits[index] ?? 0) - 1;
}

function toolDistanceTolerance(kernel: ToolKernel): number {
  return (
    TOOL_DISTANCE_TOLERANCE_ULPS * Number.EPSILON * Math.max(1, kernel.radiusMm, kernel.mmPerCell)
  );
}

function cellIndex(map: Heightmap, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= map.widthCells || y >= map.heightCells) return null;
  return y * map.widthCells + x;
}
