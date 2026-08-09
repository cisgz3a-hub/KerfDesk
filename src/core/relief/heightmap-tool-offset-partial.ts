// Position-aware cutter constraints for grids with a shorter terminal cell.
// The regular-grid indexed fast path remains in heightmap-tool-offset.ts.

import {
  partialCellCenter,
  partialCellEnd,
  partialCellSize,
  partialCellStart,
  partialGridHasPartialCell,
} from '../grid';
import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/cnc-output-precision';
import type { ToolKernel } from '../sim';
import { cuttingSurfaceDz } from '../sim/cutting-surface';
import type { Heightmap } from './heightmap';

const TOOL_DISTANCE_TOLERANCE_ULPS = 16;

export function hasPartialTerminalCandidate(
  map: Heightmap,
  cx: number,
  cy: number,
  span: number,
): boolean {
  return (
    (partialGridHasPartialCell(map, 'x') && cx + span >= map.widthCells - 1) ||
    (partialGridHasPartialCell(map, 'y') && cy + span >= map.heightCells - 1)
  );
}

export function isPartialTerminalCenter(map: Heightmap, cx: number, cy: number): boolean {
  return (
    (partialGridHasPartialCell(map, 'x') && cx === map.widthCells - 1) ||
    (partialGridHasPartialCell(map, 'y') && cy === map.heightCells - 1)
  );
}

export function partialSurfaceConstraint(
  map: Heightmap,
  kernel: ToolKernel,
  cx: number,
  cy: number,
): number {
  const context = surfaceContext(map, kernel, cx, cy);
  const span = kernel.surfaceCandidateSpanCells;
  const minX = Math.max(0, cx - span);
  const maxX = Math.min(map.widthCells - 1, cx + span);
  const minY = Math.max(0, cy - span);
  const maxY = Math.min(map.heightCells - 1, cy + span);
  let best = Number.NEGATIVE_INFINITY;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      best = Math.max(best, surfaceCandidate(context, x, y));
    }
  }
  return best;
}

export function partialTerminalSurfaceConstraint(
  map: Heightmap,
  kernel: ToolKernel,
  cx: number,
  cy: number,
): number {
  const context = surfaceContext(map, kernel, cx, cy);
  const span = kernel.surfaceCandidateSpanCells;
  const terminalColumn = partialGridHasPartialCell(map, 'x') ? map.widthCells - 1 : null;
  const terminalRow = partialGridHasPartialCell(map, 'y') ? map.heightCells - 1 : null;
  let best = Number.NEGATIVE_INFINITY;
  if (terminalColumn !== null && cx + span >= terminalColumn) {
    const minY = Math.max(0, cy - span);
    const maxY = Math.min(map.heightCells - 1, cy + span);
    for (let y = minY; y <= maxY; y += 1) {
      best = Math.max(best, surfaceCandidate(context, terminalColumn, y));
    }
  }
  if (terminalRow !== null && cy + span >= terminalRow) {
    const minX = Math.max(0, cx - span);
    const maxX = Math.min(map.widthCells - 1, cx + span);
    for (let x = minX; x <= maxX; x += 1) {
      // The terminal-column loop already evaluated the row/column intersection.
      if (x === terminalColumn) continue;
      best = Math.max(best, surfaceCandidate(context, x, terminalRow));
    }
  }
  return best;
}

export function partialFlatSurfaceConstraint(
  map: Heightmap,
  kernel: ToolKernel,
  cx: number,
  cy: number,
): number {
  const context = surfaceContext(map, kernel, cx, cy);
  const span = kernel.surfaceCandidateSpanCells;
  const minX = Math.max(0, cx - span);
  const maxX = Math.min(map.widthCells - 1, cx + span);
  const minY = Math.max(0, cy - span);
  const maxY = Math.min(map.heightCells - 1, cy + span);
  let best = Number.NEGATIVE_INFINITY;
  if (isPartialTerminalCenter(map, cx, cy)) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        best = Math.max(best, flatSurfaceCandidate(context, x, y));
      }
    }
    return best;
  }
  if (context.terminalColumn !== null && cx + span >= context.terminalColumn) {
    for (let y = minY; y <= maxY; y += 1) {
      best = Math.max(best, flatSurfaceCandidate(context, context.terminalColumn, y));
    }
  }
  if (context.terminalRow !== null && cy + span >= context.terminalRow) {
    for (let x = minX; x <= maxX; x += 1) {
      if (x === context.terminalColumn) continue;
      best = Math.max(best, flatSurfaceCandidate(context, x, context.terminalRow));
    }
  }
  return best;
}

export function partialExcludedConstraint(
  map: Heightmap,
  kernel: ToolKernel,
  cx: number,
  cy: number,
  span: number,
  pathUncertaintyMm: number,
): number {
  const inclusion = map.inclusion;
  if (inclusion === undefined) return Number.NEGATIVE_INFINITY;
  const centerX = partialCellCenter(map, 'x', cx);
  const centerY = partialCellCenter(map, 'y', cy);
  const tolerance = toolDistanceTolerance(kernel);
  let best = Number.NEGATIVE_INFINITY;
  for (let dy = -span; dy <= span; dy += 1) {
    for (let dx = -span; dx <= span; dx += 1) {
      const nx = cx + dx;
      const ny = cy + dy;
      const neighbor = kernelCellIndex(map, nx, ny);
      if (neighbor === null || inclusion[neighbor] !== 0) continue;
      const distanceMm = Math.max(
        0,
        Math.hypot(
          distanceToInterval(centerX, partialCellStart(map, 'x', nx), partialCellEnd(map, 'x', nx)),
          distanceToInterval(centerY, partialCellStart(map, 'y', ny), partialCellEnd(map, 'y', ny)),
        ) - pathUncertaintyMm,
      );
      if (distanceMm > kernel.radiusMm + tolerance) continue;
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

function distanceToInterval(value: number, start: number, end: number): number {
  if (value < start) return start - value;
  return value > end ? value - end : 0;
}

type SurfaceContext = {
  readonly map: Heightmap;
  readonly kernel: ToolKernel;
  readonly cx: number;
  readonly cy: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly tolerance: number;
  readonly terminalColumn: number | null;
  readonly terminalRow: number | null;
  readonly terminalShiftX: number;
  readonly terminalShiftY: number;
};

function surfaceContext(
  map: Heightmap,
  kernel: ToolKernel,
  cx: number,
  cy: number,
): SurfaceContext {
  return {
    map,
    kernel,
    cx,
    cy,
    centerX: partialCellCenter(map, 'x', cx),
    centerY: partialCellCenter(map, 'y', cy),
    tolerance: toolDistanceTolerance(kernel),
    terminalColumn: partialGridHasPartialCell(map, 'x') ? map.widthCells - 1 : null,
    terminalRow: partialGridHasPartialCell(map, 'y') ? map.heightCells - 1 : null,
    terminalShiftX: terminalCenterShift(map, 'x'),
    terminalShiftY: terminalCenterShift(map, 'y'),
  };
}

function flatSurfaceCandidate(context: SurfaceContext, nx: number, ny: number): number {
  const { map, kernel } = context;
  const neighbor = kernelCellIndex(map, nx, ny);
  if (neighbor === null || map.inclusion?.[neighbor] === 0) return Number.NEGATIVE_INFINITY;
  const indexedDx = nx - context.cx;
  const indexedDy = ny - context.cy;
  if (Math.hypot(indexedDx, indexedDy) * kernel.mmPerCell <= kernel.radiusMm) {
    return Number.NEGATIVE_INFINITY;
  }
  const distanceMm = Math.hypot(
    indexedDx * kernel.mmPerCell +
      (context.cx === context.terminalColumn ? context.terminalShiftX : 0) -
      (nx === context.terminalColumn ? context.terminalShiftX : 0),
    indexedDy * kernel.mmPerCell +
      (context.cy === context.terminalRow ? context.terminalShiftY : 0) -
      (ny === context.terminalRow ? context.terminalShiftY : 0),
  );
  return distanceMm <= kernel.radiusMm + context.tolerance
    ? (map.depth[neighbor] ?? 0)
    : Number.NEGATIVE_INFINITY;
}

function terminalCenterShift(map: Heightmap, axis: 'x' | 'y'): number {
  if (!partialGridHasPartialCell(map, axis)) return 0;
  const terminal = (axis === 'x' ? map.widthCells : map.heightCells) - 1;
  return (map.mmPerCell - partialCellSize(map, axis, terminal)) / 2;
}

function surfaceCandidate(context: SurfaceContext, nx: number, ny: number): number {
  const { map, kernel } = context;
  const neighbor = kernelCellIndex(map, nx, ny);
  if (neighbor === null || map.inclusion?.[neighbor] === 0) return Number.NEGATIVE_INFINITY;
  const distanceMm = Math.hypot(
    partialCellCenter(map, 'x', nx) - context.centerX,
    partialCellCenter(map, 'y', ny) - context.centerY,
  );
  if (distanceMm > kernel.radiusMm + context.tolerance) return Number.NEGATIVE_INFINITY;
  const dz = cuttingSurfaceDz(kernel.tool, Math.min(kernel.radiusMm, distanceMm), kernel.radiusMm);
  return (map.depth[neighbor] ?? 0) - dz;
}

function toolDistanceTolerance(kernel: ToolKernel): number {
  return (
    TOOL_DISTANCE_TOLERANCE_ULPS * Number.EPSILON * Math.max(1, kernel.radiusMm, kernel.mmPerCell)
  );
}

function kernelCellIndex(map: Heightmap, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= map.widthCells || y >= map.heightCells) return null;
  return y * map.widthCells + x;
}
