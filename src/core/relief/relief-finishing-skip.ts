// The finishing raster skips flats the roughing end mill already finished
// (ADR-450). A row sample is skipped when every cell the cutter could touch
// from it is finished: its model height is the height a flat level cut it to.
// The cutter standing there would cut nothing, and every sample whose reach
// holds an unfinished cell is kept, so the result is the full raster's.
//
// The kept samples fall into runs. From the end of each run the cutter goes
// to the nearest end of a run not yet cut; when that is at most the link
// length away it stays down, lifting straight up to the highest tip along the
// way, across, and straight down onto the next run (the waterline links'
// hop, ADR-423). Farther away, the chain ends and the emitter retracts.

import type { FinishingPoint } from './relief-finishing-path';

// A finished cell's model lies within this of the height it was cut to.
const FINISHED_TOLERANCE_MM = 0.001;
// Finishing cells added to the cutter's reach: a sample's neighbours stand
// for the surface between them.
const REACH_MARGIN_CELLS = 1;

export type FinishingGrid = {
  readonly widthCells: number;
  readonly heightCells: number;
  readonly depth: Float32Array;
  readonly centerX: (col: number) => number;
  readonly centerY: (row: number) => number;
};

export type FinishingRun = {
  readonly row: number;
  readonly points: ReadonlyArray<FinishingPoint>;
};

type RunChoice = { readonly index: number; readonly reversed: boolean; readonly distance: number };

export type LinkSurface = {
  // The highest tip at (x, y), never below lowerBound.
  readonly tipAt: (x: number, y: number, lowerBound: number) => number;
};

/**
 * Per cell of the emitted rows, 1 where the cutter would touch only finished
 * cells. `finishedAt` gives the height a flat level cut (x, y) to, or NaN.
 */
export function finishedSkipFlags(
  grid: FinishingGrid,
  finishedAt: (x: number, y: number) => number,
  rows: ReadonlyArray<number>,
  reachMm: number,
  mmPerCell: number,
): Uint8Array {
  const { widthCells, heightCells } = grid;
  const gap = unfinishedGaps(grid, finishedAt);
  const reach = reachMm / mmPerCell + REACH_MARGIN_CELLS;
  const span = Math.floor(reach);
  const skip = new Uint8Array(widthCells * heightCells);
  for (const row of rows) {
    for (let col = 0; col < widthCells; col += 1) {
      let clear = true;
      for (let dy = -span; clear && dy <= span; dy += 1) {
        const y = row + dy;
        if (y < 0 || y >= heightCells) continue;
        clear = (gap[y * widthCells + col] ?? 0) > Math.sqrt(reach * reach - dy * dy);
      }
      if (clear) skip[row * widthCells + col] = 1;
    }
  }
  return skip;
}

/** Cut the kept runs nearest first, staying down across short gaps. */
export function linkFinishingRuns(
  runs: ReadonlyArray<FinishingRun>,
  rowY: (row: number) => number,
  surface: LinkSurface,
  options: { readonly maxLinkMm: number; readonly checkSpacingMm: number },
): ReadonlyArray<ReadonlyArray<FinishingPoint>> {
  const byRow = new Map<number, number[]>();
  runs.forEach((run, index) => byRow.set(run.row, [...(byRow.get(run.row) ?? []), index]));
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const used = new Uint8Array(runs.length);
  const chains: FinishingPoint[][] = [];
  let chain: FinishingPoint[] | null = null;
  for (let remaining = runs.length; remaining > 0; remaining -= 1) {
    const end: FinishingPoint | undefined = chain?.[chain.length - 1];
    const next: RunChoice =
      end === undefined
        ? { index: runs.findIndex((_, index) => used[index] === 0), reversed: false, distance: 0 }
        : nearestRun(runs, used, rows, byRow, rowY, end);
    const run = runs[next.index];
    if (run === undefined) break;
    used[next.index] = 1;
    const points: ReadonlyArray<FinishingPoint> = next.reversed
      ? [...run.points].reverse()
      : run.points;
    const first = points[0];
    if (chain !== null && end !== undefined && first !== undefined) {
      if (next.distance <= options.maxLinkMm) {
        chain.push(...hop(end, first, surface, options.checkSpacingMm), ...points);
        continue;
      }
      chains.push(chain);
    }
    chain = [...points];
  }
  if (chain !== null) chains.push(chain);
  return chains;
}

// Per cell, how many cells along its row to the nearest unfinished cell
// (Infinity when the row has none).
function unfinishedGaps(
  grid: FinishingGrid,
  finishedAt: (x: number, y: number) => number,
): Float64Array {
  const { widthCells, heightCells } = grid;
  const gap = new Float64Array(widthCells * heightCells);
  for (let row = 0; row < heightCells; row += 1) {
    const y = grid.centerY(row);
    const base = row * widthCells;
    let last = Number.NEGATIVE_INFINITY;
    for (let col = 0; col < widthCells; col += 1) {
      const depth = grid.depth[base + col] ?? 0;
      const finished = Math.abs(depth - finishedAt(grid.centerX(col), y)) <= FINISHED_TOLERANCE_MM;
      if (!finished) last = col;
      gap[base + col] = col - last;
    }
    last = Number.POSITIVE_INFINITY;
    for (let col = widthCells - 1; col >= 0; col -= 1) {
      if (gap[base + col] === 0) last = col;
      gap[base + col] = Math.min(gap[base + col] ?? 0, last - col);
    }
  }
  return gap;
}

// The unused run with an end nearest `from`. Rows are searched outward from
// the nearest one, each way until a row lies farther than the best found.
function nearestRun(
  runs: ReadonlyArray<FinishingRun>,
  used: Uint8Array,
  rows: ReadonlyArray<number>,
  byRow: ReadonlyMap<number, ReadonlyArray<number>>,
  rowY: (row: number) => number,
  from: FinishingPoint,
): RunChoice {
  let best: RunChoice = { index: -1, reversed: false, distance: Number.POSITIVE_INFINITY };
  const scan = (row: number): boolean => {
    if (Math.abs(rowY(row) - from.y) > best.distance) return false;
    for (const index of byRow.get(row) ?? []) {
      const points = runs[index]?.points ?? [];
      const head = points[0];
      const tail = points[points.length - 1];
      if (used[index] === 1 || head === undefined || tail === undefined) continue;
      const toHead = Math.hypot(head.x - from.x, head.y - from.y);
      const toTail = Math.hypot(tail.x - from.x, tail.y - from.y);
      if (toHead < best.distance) best = { index, reversed: false, distance: toHead };
      if (toTail < best.distance) best = { index, reversed: true, distance: toTail };
    }
    return true;
  };
  const start = nearestRowIndex(rows, rowY, from.y);
  for (let k = start; k < rows.length && scan(rows[k] ?? 0); k += 1);
  for (let k = start - 1; k >= 0 && scan(rows[k] ?? 0); k -= 1);
  return best;
}

function nearestRowIndex(
  rows: ReadonlyArray<number>,
  rowY: (row: number) => number,
  y: number,
): number {
  let best = 0;
  rows.forEach((row, index) => {
    if (Math.abs(rowY(row) - y) < Math.abs(rowY(rows[best] ?? row) - y)) best = index;
  });
  return best;
}

// Up to the highest tip on the straight line, across, and down: the tip is
// checked every `spacing` along the move, as waterline links are.
function hop(
  from: FinishingPoint,
  to: FinishingPoint,
  surface: LinkSurface,
  spacing: number,
): ReadonlyArray<FinishingPoint> {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(length / spacing));
  let top = Math.max(from.z, to.z);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    top = surface.tipAt(from.x + t * (to.x - from.x), from.y + t * (to.y - from.y), top);
  }
  const corners: FinishingPoint[] = [];
  if (top > from.z) corners.push({ x: from.x, y: from.y, z: top });
  if (top > to.z) corners.push({ x: to.x, y: to.y, z: top });
  return corners;
}
