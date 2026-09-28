// Carves the stock a CNC program cuts, move by move, for the carved stock
// view (ADR-487). It runs in its own worker (stock-worker.ts). The stock is a
// removal grid over the moves that go below Z0, the stock top, as Cut 3D
// assumes too, with room for the widest bit around them. Every move sweeps
// its bit through the grid (stock-sweep.ts), rapids included: a rapid below
// the stock top cuts (or breaks the bit) on the machine, so it shows. Each
// cell keeps the deepest the bit has been, so playback that moves forward only
// sweeps the moves it passed; going back starts the grid again.

import type { CncTool } from '../../core/scene';
// Deep imports: the core/sim barrel is capped at 20 exports by its index contract.
import { createRemovalGrid, type RemovalGrid } from '../../core/sim/removal-grid';
import { kernelForTool, type ToolKernel } from '../../core/sim/tool-kernels';
import type { ProgramToolGeometry } from './program-tools';
import { sweepMove } from './stock-sweep';

/** Where the stock is and how finely it is carved. */
export type StockLayout = {
  readonly originX: number;
  readonly originY: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly mmPerCell: number;
  /** The stock's bottom: the project's thickness below Z0, or else the deepest cut less a margin. */
  readonly bottomZ: number;
};

export type StockMoves = {
  readonly segmentCount: number;
  readonly positions: Float32Array;
  /** Which of `tools` each move cuts with. */
  readonly segTool: Uint16Array;
  /** Each tool's shape; null where the program does not give it. */
  readonly tools: ReadonlyArray<ProgramToolGeometry | null>;
};

/** How far playback has got: every move before `index`, and `fraction` of that one. */
export type StockTarget = { readonly index: number; readonly fraction: number };

/** Rows of the grid a carve changed. */
export type StockChange = { readonly firstRow: number; readonly rowCount: number };

export type StockCarver = {
  readonly grid: RemovalGrid;
  readonly carveTo: (target: StockTarget) => StockChange | null;
};

/** The bit carved with where the program does not say: a 1/8 inch end mill. */
export const UNKNOWN_TOOL: ProgramToolGeometry = { kind: 'end-mill', diameterMm: 3.175 };

// About a million cells: fine enough to read a carving, quick to carve again.
const MAX_CELLS = 1_000_000;
// The depths go to the GPU as one texture; every WebGL 2 takes this many a side.
const MAX_CELLS_A_SIDE = 2048;
const MIN_CELL_MM = 0.05;
const MARGIN_MM = 2;
const BOTTOM_MARGIN_MM = 1;
const FLOATS_PER_MOVE = 6;

/**
 * Where the stock is. Its bottom is `thicknessMm` below Z0 when the project
 * says how thick the stock is: a cut through it then leaves a hole.
 */
export function stockLayout(moves: StockMoves, thicknessMm?: number): StockLayout | null {
  const cut = cutExtent(moves);
  if (cut === null) return null;
  const room = widestRadius(moves.tools) + MARGIN_MM;
  const widthMm = cut.maxX - cut.minX + 2 * room;
  const heightMm = cut.maxY - cut.minY + 2 * room;
  const mmPerCell = Math.max(
    MIN_CELL_MM,
    Math.sqrt((widthMm * heightMm) / MAX_CELLS),
    widthMm / MAX_CELLS_A_SIDE,
    heightMm / MAX_CELLS_A_SIDE,
  );
  return {
    originX: cut.minX - room,
    originY: cut.minY - room,
    widthMm,
    heightMm,
    mmPerCell,
    bottomZ:
      thicknessMm !== undefined && thicknessMm > 0 ? -thicknessMm : cut.minZ - BOTTOM_MARGIN_MM,
  };
}

export function createStockCarver(layout: StockLayout, moves: StockMoves): StockCarver | null {
  const created = createRemovalGrid(layout);
  if (created.kind === 'error') return null;
  const { grid } = created;
  const kernels = moves.tools.map((tool) => kernelForTool(asCncTool(tool), grid.mmPerCell));
  const fallback = kernelForTool(asCncTool(null), grid.mmPerCell);
  const kernelAt = (index: number): ToolKernel => kernels[moves.segTool[index] ?? 0] ?? fallback;
  let done: StockTarget = { index: 0, fraction: 0 };
  return {
    grid,
    carveTo: (target) => {
      const restart = before(target, done);
      if (restart) {
        grid.depth.fill(0);
        done = { index: 0, fraction: 0 };
      }
      const rows = stampRange(grid, moves, kernelAt, done, target);
      done = target;
      if (restart) return { firstRow: 0, rowCount: grid.heightCells };
      return rows;
    },
  };
}

/** Whether a program cuts below the stock top at all. */
export function carvesStock(moves: Pick<StockMoves, 'segmentCount' | 'positions'>): boolean {
  for (let at = 2; at < moves.segmentCount * FLOATS_PER_MOVE; at += 3) {
    if ((moves.positions[at] ?? 0) < 0) return true;
  }
  return false;
}

// Sweeps the moves from where the last carve stopped (that move again, whole)
// up to the target, and returns the rows they reach.
function stampRange(
  grid: RemovalGrid,
  moves: StockMoves,
  kernelAt: (index: number) => ToolKernel,
  from: StockTarget,
  to: StockTarget,
): StockChange | null {
  const rows = { first: Infinity, last: -Infinity };
  const last = Math.min(to.index, moves.segmentCount - 1);
  for (let index = from.index; index <= last; index += 1) {
    const upTo = index < to.index ? 1 : to.fraction;
    if (upTo <= 0) continue;
    const start = point(moves.positions, index * FLOATS_PER_MOVE);
    const end = point(moves.positions, index * FLOATS_PER_MOVE + 3);
    sweepMove(grid, kernelAt(index), start, end, upTo, rows);
  }
  if (rows.first > rows.last) return null;
  return { firstRow: rows.first, rowCount: rows.last - rows.first + 1 };
}

function before(target: StockTarget, done: StockTarget): boolean {
  return (
    target.index < done.index || (target.index === done.index && target.fraction < done.fraction)
  );
}

function point(positions: Float32Array, at: number): { x: number; y: number; z: number } {
  return { x: positions[at] ?? 0, y: positions[at + 1] ?? 0, z: positions[at + 2] ?? 0 };
}

function cutExtent(
  moves: StockMoves,
): { minX: number; maxX: number; minY: number; maxY: number; minZ: number } | null {
  let extent: { minX: number; maxX: number; minY: number; maxY: number; minZ: number } | null =
    null;
  for (let index = 0; index < moves.segmentCount; index += 1) {
    const start = point(moves.positions, index * FLOATS_PER_MOVE);
    const end = point(moves.positions, index * FLOATS_PER_MOVE + 3);
    if (start.z >= 0 && end.z >= 0) continue;
    extent ??= { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: 0 };
    for (const at of [start, end]) {
      extent.minX = Math.min(extent.minX, at.x);
      extent.maxX = Math.max(extent.maxX, at.x);
      extent.minY = Math.min(extent.minY, at.y);
      extent.maxY = Math.max(extent.maxY, at.y);
      extent.minZ = Math.min(extent.minZ, at.z);
    }
  }
  return extent;
}

function widestRadius(tools: ReadonlyArray<ProgramToolGeometry | null>): number {
  let widest = UNKNOWN_TOOL.diameterMm / 2;
  for (const tool of tools) widest = Math.max(widest, (tool?.diameterMm ?? 0) / 2);
  return widest;
}

function asCncTool(geometry: ProgramToolGeometry | null): CncTool {
  const shape = geometry ?? UNKNOWN_TOOL;
  return {
    id: '',
    name: '',
    kind: shape.kind,
    diameterMm: shape.diameterMm,
    ...(shape.tipAngleDeg === undefined ? {} : { tipAngleDeg: shape.tipAngleDeg }),
    ...(shape.tipDiameterMm === undefined ? {} : { tipDiameterMm: shape.tipDiameterMm }),
  };
}
