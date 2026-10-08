import { reliefCutterBudgetError } from './relief-cutter-budget';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { partialCellEnd, partialCellStart } from '../grid';
import { kernelForTool, type ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import type { FinishingPoint } from './relief-finishing-path';

const MAX_PREDICTION_WORK = 32_000_000;
export type ReliefResidualPrediction = {
  readonly selected: Uint8Array;
  readonly selectedCells: number;
  readonly maximumResidualMm: number;
  readonly fallbackReason?: string;
};

/** Upper remaining-stock bounds from positions on the actual emitted predecessor moves.
 * A cell is removed only when the cutter covers its entire rectangle, using its
 * farthest corner height. Missed contact leaves MORE stock selected. This is a
 * prediction of the sampled target and cutter law, not measured material.
 */
export function predictReliefResidual(
  map: Heightmap,
  passes: ReadonlyArray<CncPass>,
  tool: CncTool,
  thresholdMm: number,
): ReliefResidualPrediction {
  if (
    reliefCutterBudgetError(tool, map.mmPerCell) !== null ||
    predictionWork(map, passes, tool.diameterMm / 2) > MAX_PREDICTION_WORK
  ) {
    return fullResidual(
      map,
      'Remaining-stock prediction exceeded its work budget; full fine finishing retained.',
    );
  }
  const kernel = kernelForTool(tool, map.mmPerCell);
  const upper = new Float64Array(map.depth.length);
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    const first = pass.points[0];
    if (first !== undefined) stampUpperStock(map, upper, kernel, first);
    for (let i = 1; i < pass.points.length; i += 1) {
      const a = pass.points[i - 1],
        b = pass.points[i];
      if (a !== undefined && b !== undefined) stampMove(map, upper, kernel, a, b);
    }
  }
  return residualSelection(map, upper, thresholdMm);
}

function residualSelection(
  map: Heightmap,
  upper: Float64Array,
  thresholdMm: number,
): ReliefResidualPrediction {
  const selected = new Uint8Array(map.depth.length);
  let selectedCells = 0,
    maximumResidualMm = 0;
  for (let row = 0; row < map.heightCells; row += 1) {
    for (let col = 0; col < map.widthCells; col += 1) {
      const index = row * map.widthCells + col;
      if (map.inclusion?.[index] === 0) continue;
      const residual = Math.max(0, (upper[index] ?? 0) - targetLowerBound(map, col, row));
      maximumResidualMm = Math.max(maximumResidualMm, residual);
      if (residual + 1e-6 > thresholdMm) {
        selected[index] = 1;
        selectedCells += 1;
      }
    }
  }
  return { selected, selectedCells, maximumResidualMm };
}

function predictionWork(map: Heightmap, passes: ReadonlyArray<CncPass>, radiusMm: number): number {
  const side = 2 * Math.ceil(radiusMm / map.mmPerCell) + 3;
  let work = 0;
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    for (let i = 1; i < pass.points.length; i += 1) {
      const a = pass.points[i - 1],
        b = pass.points[i];
      if (a === undefined || b === undefined) continue;
      work +=
        (1 + Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / (map.mmPerCell / 2))) *
        side *
        side;
      if (work > MAX_PREDICTION_WORK) return work;
    }
    work += side * side;
  }
  return work;
}

function stampMove(
  map: Heightmap,
  upper: Float64Array,
  kernel: ToolKernel,
  a: FinishingPoint,
  b: FinishingPoint,
): void {
  const count = Math.max(
    1,
    Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / (map.mmPerCell / 2)),
  );
  for (let i = 1; i <= count; i += 1) {
    const t = i / count;
    stampUpperStock(map, upper, kernel, {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    });
  }
}

function stampUpperStock(
  map: Heightmap,
  upper: Float64Array,
  kernel: ToolKernel,
  point: FinishingPoint,
): void {
  if (point.z >= 0) return;
  const cell = map.mmPerCell,
    radius = kernel.radiusMm;
  const left = Math.max(0, Math.floor((point.x - radius) / cell));
  const right = Math.min(map.widthCells - 1, Math.floor((point.x + radius) / cell));
  const bottom = Math.max(0, Math.floor((point.y - radius) / cell));
  const top = Math.min(map.heightCells - 1, Math.floor((point.y + radius) / cell));
  for (let row = bottom; row <= top; row += 1) {
    for (let col = left; col <= right; col += 1) {
      const dx = Math.max(
        Math.abs(partialCellStart(map, 'x', col) - point.x),
        Math.abs(partialCellEnd(map, 'x', col) - point.x),
      );
      const dy = Math.max(
        Math.abs(partialCellStart(map, 'y', row) - point.y),
        Math.abs(partialCellEnd(map, 'y', row) - point.y),
      );
      const farthest = Math.hypot(dx, dy);
      if (farthest > radius) continue;
      const index = row * map.widthCells + col;
      upper[index] = Math.min(upper[index] ?? 0, point.z + kernel.surfaceDzAtRadius(farthest));
    }
  }
}

function targetLowerBound(map: Heightmap, col: number, row: number): number {
  let lower = map.depth[row * map.widthCells + col] ?? 0;
  for (let j = Math.max(0, row - 1); j <= Math.min(map.heightCells - 1, row + 1); j += 1) {
    for (let i = Math.max(0, col - 1); i <= Math.min(map.widthCells - 1, col + 1); i += 1) {
      const index = j * map.widthCells + i;
      if (map.inclusion?.[index] !== 0) lower = Math.min(lower, map.depth[index] ?? 0);
    }
  }
  return lower;
}

function fullResidual(map: Heightmap, reason: string): ReliefResidualPrediction {
  const selected = Uint8Array.from(map.depth, (_, index) => (map.inclusion?.[index] === 0 ? 0 : 1));
  let maximumResidualMm = 0;
  for (const depth of map.depth) maximumResidualMm = Math.max(maximumResidualMm, -depth);
  return {
    selected,
    selectedCells: selected.reduce((sum, value) => sum + value, 0),
    maximumResidualMm,
    fallbackReason: reason,
  };
}
