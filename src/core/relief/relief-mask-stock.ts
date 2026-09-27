// Excluded stock as a cutter centred anywhere meets it (ADR-484).
//
// A mask that excludes cells leaves their stock uncut. The dilation protects
// it at sample centres (heightmap-tool-offset.ts): every excluded cell is a
// block over its whole physical cell, standing an output quantum above stock
// top, and the cutter keeps a clearance further off it in XY than it reaches.
// Waterline finishing places its vertices and checks its moves between
// samples, so it needs the same blocks at any point.
//
// Every block stands at the same height and every cutter law is nondecreasing
// in radius, so the nearest excluded cell decides: a cutter centred d from it
// needs its tip at top - dz(d - clearance) or above. The search walks rings of
// cells outward from the point and stops once a ring lies further off than the
// nearest block found; a table of the cells with any excluded cell in reach
// answers "nothing near" with one read.
//
// A straight move is checked exactly against every block at the edge of the
// excluded area within its reach (relief-mask-stock-move.ts): the nearest
// excluded point to any point outside the area lies on its edge.

import { partialCellCenter, partialCellEnd, partialCellStart } from '../grid';
import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/precision';
import type { ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import {
  blockExcess,
  type BlockExcess,
  type BlockLaw,
  type Move,
  type Rectangle,
} from './relief-mask-stock-move';
import type { FinishingPoint } from './relief-finishing-path';

// A move may stand this much further below a block's requirement than the
// stock's tolerance: floating-point noise, a millionth of the output quantum
// the requirement already keeps.
const MOVE_SLACK_MM = 1e-9;

export type MaskStock = {
  /**
   * The lowest tip of a cutter centred at (x, y) in map mm that clears every
   * excluded block, or -Infinity when no block is in reach.
   */
  readonly tipAt: (x: number, y: number) => number;
  /**
   * Where the straight move from `from` to `to` stands furthest below what
   * the blocks require, lifted to their requirement there, and the highest
   * requirement anywhere along the move; null when it stands no further below
   * than the tolerance anywhere.
   */
  readonly moveExcess: (from: FinishingPoint, to: FinishingPoint) => MoveExcess | null;
};

export type MoveExcess = { readonly point: FinishingPoint; readonly highest: number };

type Stock = {
  readonly inclusion: Uint8Array;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly mmPerCell: number;
  readonly x0: Float64Array;
  readonly x1: Float64Array;
  readonly y0: Float64Array;
  readonly y1: Float64Array;
  // 1 where some excluded cell lies within `span` cells on both axes.
  readonly near: Uint8Array;
  // 1 for an excluded cell beside an included one or the map's edge.
  readonly edge: Uint8Array;
  readonly law: BlockLaw;
  readonly span: number;
  readonly clearanceMm: number;
  readonly toleranceMm: number;
  readonly radiusMm: number;
  readonly tolerance: number;
  readonly dz: (radiusMm: number) => number;
};

/**
 * The excluded blocks of a masked map for one cutter, kept `clearanceMm` off
 * in XY; null when the map excludes nothing. With a tolerance the blocks stand
 * that much higher and a move may dip that far below them, so it never dips
 * below the blocks themselves: a straight move over the curved requirement
 * then settles after a few splits instead of splitting without end.
 */
export function createMaskStock(
  map: Heightmap,
  kernel: ToolKernel,
  clearanceMm: number,
  toleranceMm = 0,
): MaskStock | null {
  const inclusion = map.inclusion;
  if (inclusion === undefined || !inclusion.includes(0)) return null;
  const { widthCells, heightCells, mmPerCell } = map;
  const tolerance = 16 * Number.EPSILON * Math.max(1, kernel.radiusMm, mmPerCell);
  // An excluded cell m cells away on either axis lies at least m - 1 cells off.
  const span = Math.ceil((kernel.radiusMm + clearanceMm + tolerance) / mmPerCell) + 1;
  const stock: Stock = {
    inclusion,
    widthCells,
    heightCells,
    mmPerCell,
    x0: Float64Array.from({ length: widthCells }, (_, i) => partialCellStart(map, 'x', i)),
    x1: Float64Array.from({ length: widthCells }, (_, i) => partialCellEnd(map, 'x', i)),
    y0: Float64Array.from({ length: heightCells }, (_, j) => partialCellStart(map, 'y', j)),
    y1: Float64Array.from({ length: heightCells }, (_, j) => partialCellEnd(map, 'y', j)),
    near: excludedWithin(inclusion, widthCells, heightCells, span),
    edge: excludedEdge(inclusion, widthCells, heightCells),
    law: {
      top: CNC_MASK_EMISSION_Z_CLEARANCE_MM + toleranceMm,
      clearanceMm,
      radiusMm: kernel.radiusMm,
      reachMm: kernel.radiusMm + clearanceMm + tolerance,
      dz: kernel.surfaceDzAtRadius,
    },
    span,
    clearanceMm,
    toleranceMm,
    radiusMm: kernel.radiusMm,
    tolerance,
    dz: kernel.surfaceDzAtRadius,
  };
  return {
    tipAt: (x, y) => stockTipAt(stock, x, y),
    moveExcess: (from, to) => stockMoveExcess(stock, from, to),
  };
}

/**
 * A tip surface raised over the excluded blocks, sample by sample, so each
 * sample clears them where it stands. Excluded samples stand on their block.
 */
export function raisedOverStock(
  map: Heightmap,
  dilated: Float32Array,
  stock: MaskStock,
): Float32Array {
  const tip = dilated.slice();
  for (let j = 0; j < map.heightCells; j += 1) {
    const y = partialCellCenter(map, 'y', j);
    for (let i = 0; i < map.widthCells; i += 1) {
      const index = j * map.widthCells + i;
      const needed = stock.tipAt(partialCellCenter(map, 'x', i), y);
      if (needed > (tip[index] ?? 0)) tip[index] = float32AtLeast(needed);
    }
  }
  return tip;
}

const float32 = new Float32Array(1);
const float32Bits = new Uint32Array(float32.buffer);

// The least Float32 value at or above `value`.
function float32AtLeast(value: number): number {
  float32[0] = value;
  const rounded = float32[0] ?? 0;
  if (rounded >= value) return rounded;
  // Rounded down: one step toward +Infinity, which for a negative value is a
  // step toward zero.
  if (rounded === 0) return 2 ** -149;
  float32Bits[0] = (float32Bits[0] ?? 0) + (rounded > 0 ? 1 : -1);
  return float32[0] ?? 0;
}

function stockMoveExcess(
  stock: Stock,
  from: FinishingPoint,
  to: FinishingPoint,
): MoveExcess | null {
  const move = {
    x: from.x,
    y: from.y,
    z: from.z,
    dx: to.x - from.x,
    dy: to.y - from.y,
    dz: to.z - from.z,
  };
  const { worst, highest } = worstBlock(stock, move);
  if (worst === null || !(worst.h < -stock.toleranceMm - MOVE_SLACK_MM)) return null;
  const x = from.x + worst.t * move.dx;
  const y = from.y + worst.t * move.dy;
  const z = from.z + worst.t * move.dz;
  return { point: { x, y, z: Math.max(z, stockTipAt(stock, x, y)) }, highest };
}

// The block at the edge of the excluded area the move stands lowest against,
// and the highest requirement of any of them along it.
function worstBlock(
  stock: Stock,
  move: Move,
): { readonly worst: BlockExcess | null; readonly highest: number } {
  const { widthCells, heightCells, mmPerCell, law } = stock;
  const firstI = cellAt(Math.min(move.x, move.x + move.dx) - law.reachMm, widthCells, mmPerCell);
  const lastI = cellAt(Math.max(move.x, move.x + move.dx) + law.reachMm, widthCells, mmPerCell);
  const firstJ = cellAt(Math.min(move.y, move.y + move.dy) - law.reachMm, heightCells, mmPerCell);
  const lastJ = cellAt(Math.max(move.y, move.y + move.dy) + law.reachMm, heightCells, mmPerCell);
  let worst: BlockExcess | null = null;
  let highest = Number.NEGATIVE_INFINITY;
  for (let j = firstJ; j <= lastJ; j += 1) {
    for (let i = firstI; i <= lastI; i += 1) {
      if (stock.edge[j * widthCells + i] !== 1) continue;
      const excess = blockExcess(move, cellRectangle(stock, i, j), law);
      if (excess === null) continue;
      highest = Math.max(highest, excess.highest);
      if (worst === null || excess.h < worst.h) worst = excess;
    }
  }
  return { worst, highest };
}

function cellRectangle(stock: Stock, i: number, j: number): Rectangle {
  return {
    x0: stock.x0[i] ?? 0,
    x1: stock.x1[i] ?? 0,
    y0: stock.y0[j] ?? 0,
    y1: stock.y1[j] ?? 0,
  };
}

function stockTipAt(stock: Stock, x: number, y: number): number {
  const i = cellAt(x, stock.widthCells, stock.mmPerCell);
  const j = cellAt(y, stock.heightCells, stock.mmPerCell);
  if (stock.near[j * stock.widthCells + i] === 0) return Number.NEGATIVE_INFINITY;
  const distanceMm = Math.max(0, nearestExcluded(stock, x, y, i, j) - stock.clearanceMm);
  if (distanceMm > stock.radiusMm + stock.tolerance) return Number.NEGATIVE_INFINITY;
  return stock.law.top - stock.dz(Math.min(stock.radiusMm, distanceMm));
}

// The cell holding a coordinate, clamped to the map: a point off the map is
// only further from every cell than from the edge cell it is clamped to.
function cellAt(coordinate: number, cells: number, mmPerCell: number): number {
  return Math.min(cells - 1, Math.max(0, Math.floor(coordinate / mmPerCell)));
}

// Distance from (x, y) to the nearest excluded cell within `span` rings of
// cell (i, j), or +Infinity when none is.
function nearestExcluded(stock: Stock, x: number, y: number, i: number, j: number): number {
  const ring = { stock, x, y, best: Number.POSITIVE_INFINITY };
  for (let m = 0; m <= stock.span; m += 1) {
    // Every cell of ring m lies at least m - 1 cells off on one axis.
    if ((m - 1) * stock.mmPerCell - stock.tolerance > ring.best) break;
    if (m === 0) {
      visitRow(ring, j, i, i);
    } else {
      visitRow(ring, j - m, i - m, i + m);
      visitRow(ring, j + m, i - m, i + m);
      visitColumn(ring, i - m, j - m + 1, j + m - 1);
      visitColumn(ring, i + m, j - m + 1, j + m - 1);
    }
    if (ring.best === 0) break;
  }
  return ring.best;
}

type Ring = { readonly stock: Stock; readonly x: number; readonly y: number; best: number };

function visitRow(ring: Ring, j: number, fromI: number, toI: number): void {
  const { stock } = ring;
  if (j < 0 || j >= stock.heightCells) return;
  const last = Math.min(stock.widthCells - 1, toI);
  for (let i = Math.max(0, fromI); i <= last; i += 1) visitCell(ring, i, j);
}

function visitColumn(ring: Ring, i: number, fromJ: number, toJ: number): void {
  const { stock } = ring;
  if (i < 0 || i >= stock.widthCells) return;
  const last = Math.min(stock.heightCells - 1, toJ);
  for (let j = Math.max(0, fromJ); j <= last; j += 1) visitCell(ring, i, j);
}

function visitCell(ring: Ring, i: number, j: number): void {
  const { stock } = ring;
  if (stock.inclusion[j * stock.widthCells + i] !== 0) return;
  const dx = gap(ring.x, stock.x0[i] ?? 0, stock.x1[i] ?? 0);
  const dy = gap(ring.y, stock.y0[j] ?? 0, stock.y1[j] ?? 0);
  ring.best = Math.min(ring.best, Math.hypot(dx, dy));
}

function gap(value: number, start: number, end: number): number {
  if (value < start) return start - value;
  return value > end ? value - end : 0;
}

function excludedEdge(inclusion: Uint8Array, widthCells: number, heightCells: number): Uint8Array {
  const edge = new Uint8Array(widthCells * heightCells);
  for (let j = 0; j < heightCells; j += 1) {
    for (let i = 0; i < widthCells; i += 1) {
      if (inclusion[j * widthCells + i] !== 0) continue;
      edge[j * widthCells + i] = besideIncluded(inclusion, widthCells, heightCells, i, j) ? 1 : 0;
    }
  }
  return edge;
}

// Whether any of the cell's eight neighbours is included or off the map.
function besideIncluded(
  inclusion: Uint8Array,
  widthCells: number,
  heightCells: number,
  i: number,
  j: number,
): boolean {
  for (let dj = -1; dj <= 1; dj += 1) {
    for (let di = -1; di <= 1; di += 1) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= widthCells || nj >= heightCells) return true;
      if (inclusion[nj * widthCells + ni] !== 0) return true;
    }
  }
  return false;
}

// 1 for every cell with an excluded cell at most `span` cells off on both
// axes: a running count along each row, then along each column.
function excludedWithin(
  inclusion: Uint8Array,
  widthCells: number,
  heightCells: number,
  span: number,
): Uint8Array {
  const rows = new Uint8Array(widthCells * heightCells);
  for (let j = 0; j < heightCells; j += 1) {
    const row = j * widthCells;
    windowed(
      widthCells,
      span,
      (i) => inclusion[row + i] === 0,
      (i) => {
        rows[row + i] = 1;
      },
    );
  }
  const near = new Uint8Array(widthCells * heightCells);
  for (let i = 0; i < widthCells; i += 1) {
    windowed(
      heightCells,
      span,
      (j) => rows[j * widthCells + i] === 1,
      (j) => {
        near[j * widthCells + i] = 1;
      },
    );
  }
  return near;
}

// Calls mark(k) for every k in [0, length) with some set(k') for
// |k - k'| <= span.
function windowed(
  length: number,
  span: number,
  set: (k: number) => boolean,
  mark: (k: number) => void,
): void {
  let count = 0;
  for (let k = 0; k < Math.min(length, span); k += 1) if (set(k)) count += 1;
  for (let k = 0; k < length; k += 1) {
    if (k + span < length && set(k + span)) count += 1;
    if (k - span - 1 >= 0 && set(k - span - 1)) count -= 1;
    if (count > 0) mark(k);
  }
}
