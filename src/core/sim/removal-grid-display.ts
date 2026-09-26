// downsampleRemovalGrid — reduce a removal grid to a display-sized grid for
// the 3D cut preview (ADR-103 G4). Each fully included output cell takes the
// deepest value in its source block; any excluded source coverage keeps the
// coarse display cell excluded so preview downsampling cannot fill holes.
//
// One exception keeps material left inside a cut (ADR-425): a block wholly
// below the stock top that is two flat levels, such as a tab standing in a
// profile groove, shows the level most of the block has. Deepest-only pooling
// erased any tab shorter than about two display cells. Blocks that reach the
// stock top stay deepest, so thin grooves and V-carve strokes never vanish,
// and sloped relief blocks stay deepest because they are not two-level.
// Pure and deterministic (indexed loops only).

import { partialCellCount } from '../grid';
import type { RemovalGrid, RemovalGridResolution } from './removal-grid';

export function downsampleRemovalGrid(grid: RemovalGrid, maxCellsAcross: number): RemovalGrid {
  const factor = displayFactor(grid, maxCellsAcross);
  if (factor <= 1) return grid;
  const mmPerCell = grid.mmPerCell * factor;
  const widthCells =
    partialCellCount(grid.widthMm, mmPerCell) ?? Math.ceil(grid.widthCells / factor);
  const heightCells =
    partialCellCount(grid.heightMm, mmPerCell) ?? Math.ceil(grid.heightCells / factor);
  const depth = new Float32Array(widthCells * heightCells);
  const inclusion = grid.inclusion === undefined ? undefined : new Uint8Array(depth.length);
  for (let row = 0; row < heightCells; row += 1) {
    for (let col = 0; col < widthCells; col += 1) {
      const sampled = downsampledCell(grid, factor, row, col);
      const targetIndex = row * widthCells + col;
      depth[targetIndex] = sampled.depth;
      if (inclusion !== undefined && sampled.included) inclusion[targetIndex] = 1;
    }
  }
  return {
    widthCells,
    heightCells,
    widthMm: grid.widthMm,
    heightMm: grid.heightMm,
    mmPerCell,
    originX: grid.originX,
    originY: grid.originY,
    depth,
    ...(inclusion === undefined ? {} : { inclusion }),
    resolution: removalGridDisplayResolution(grid, maxCellsAcross),
  };
}

/** Resolution of the bounded display copy without allocating that copy. */
export function removalGridDisplayResolution(
  grid: RemovalGrid,
  maxCellsAcross: number,
): RemovalGridResolution {
  const factor = displayFactor(grid, maxCellsAcross);
  if (factor <= 1) return grid.resolution;
  return {
    requestedMmPerCell: grid.resolution.requestedMmPerCell,
    effectiveMmPerCell: grid.mmPerCell * factor,
    reason: 'display-mesh-cell-budget',
  };
}

function displayFactor(grid: RemovalGrid, maxCellsAcross: number): number {
  const across = Math.max(1, Math.floor(maxCellsAcross));
  return Math.ceil(Math.max(grid.widthCells, grid.heightCells) / across);
}

// Depths within this of the stock top count as uncut material.
const STOCK_TOP_TOLERANCE_MM = 1e-4;
// Samples within this of a block's extreme belong to that flat level.
const FLAT_LEVEL_TOLERANCE_MM = 0.01;
// Share of a block the two flat levels must cover for it to read as a step.
const TWO_LEVEL_SHARE = 0.9;

type SourceBlock = {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly colStart: number;
  readonly colEnd: number;
};

function downsampledCell(
  grid: RemovalGrid,
  factor: number,
  row: number,
  col: number,
): { readonly depth: number; readonly included: boolean } {
  const block = {
    rowStart: row * factor,
    rowEnd: Math.min(grid.heightCells, (row + 1) * factor),
    colStart: col * factor,
    colEnd: Math.min(grid.widthCells, (col + 1) * factor),
  };
  let deepest = 0;
  let highest = Number.NEGATIVE_INFINITY;
  for (let sourceRow = block.rowStart; sourceRow < block.rowEnd; sourceRow += 1) {
    for (let sourceCol = block.colStart; sourceCol < block.colEnd; sourceCol += 1) {
      const sourceIndex = sourceRow * grid.widthCells + sourceCol;
      if (grid.inclusion?.[sourceIndex] === 0) return { depth: 0, included: false };
      const depth = grid.depth[sourceIndex] ?? 0;
      deepest = Math.min(deepest, depth);
      highest = Math.max(highest, depth);
    }
  }
  const insideCut = highest < -STOCK_TOP_TOLERANCE_MM;
  const stepped = highest - deepest > FLAT_LEVEL_TOLERANCE_MM;
  const depth = insideCut && stepped ? majorityFlatLevel(grid, block, deepest, highest) : deepest;
  return { depth, included: true };
}

// The level most of a two-level block sits at; deepest when the block is not
// two flat levels (a slope, a ramp) or the levels tie.
function majorityFlatLevel(
  grid: RemovalGrid,
  block: SourceBlock,
  deepest: number,
  highest: number,
): number {
  let atDeepest = 0;
  let atHighest = 0;
  let samples = 0;
  for (let sourceRow = block.rowStart; sourceRow < block.rowEnd; sourceRow += 1) {
    for (let sourceCol = block.colStart; sourceCol < block.colEnd; sourceCol += 1) {
      const depth = grid.depth[sourceRow * grid.widthCells + sourceCol] ?? 0;
      samples += 1;
      if (depth - deepest <= FLAT_LEVEL_TOLERANCE_MM) atDeepest += 1;
      else if (highest - depth <= FLAT_LEVEL_TOLERANCE_MM) atHighest += 1;
    }
  }
  if (atDeepest + atHighest < samples * TWO_LEVEL_SHARE) return deepest;
  return atHighest > atDeepest ? highest : deepest;
}
