// cell-grid — a flat uniform-grid spatial index (compressed rows, typed arrays).
//
// Why a grid and not a tree: every snap query is a small box around the
// pointer, the data is static once built (it is keyed by the path object, which
// is immutable), and a 200k-point photo trace must index in one pass without
// allocating per point. Cells are sized for about four entries each, so a query
// touches a few cells and a few dozen entries whatever the drawing's size.
//
// Box entries (segments) are filed in every cell they overlap. One that would
// cover more than WIDE_CELL_LIMIT cells — a long edge across the whole trace —
// goes on a short `wide` list scanned on every query instead, so a single long
// diagonal never fills the grid.

import type { Box } from './snap-affine';

const TARGET_ENTRIES_PER_CELL = 4;
const MAX_CELLS_PER_AXIS = 4096;
const WIDE_CELL_LIMIT = 64;

export type CellGrid = {
  readonly minX: number;
  readonly minY: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  // Entries of cell i are entries[starts[i] .. starts[i + 1]).
  readonly starts: Int32Array;
  readonly entries: Int32Array;
  readonly wide: Int32Array;
};

type Layout = Pick<CellGrid, 'minX' | 'minY' | 'cellSize' | 'cols' | 'rows'>;

function layoutFor(bounds: Box, count: number): Layout {
  const width = Math.max(bounds.maxX - bounds.minX, 1e-9);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-9);
  const targetCells = Math.max(1, Math.ceil(count / TARGET_ENTRIES_PER_CELL));
  const cellSize = Math.max(
    Math.sqrt((width * height) / targetCells),
    Math.max(width, height) / MAX_CELLS_PER_AXIS,
  );
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    cellSize,
    cols: Math.min(MAX_CELLS_PER_AXIS, Math.floor(width / cellSize) + 1),
    rows: Math.min(MAX_CELLS_PER_AXIS, Math.floor(height / cellSize) + 1),
  };
}

function column(layout: Layout, x: number): number {
  const index = Math.floor((x - layout.minX) / layout.cellSize);
  return Math.min(layout.cols - 1, Math.max(0, index));
}

function row(layout: Layout, y: number): number {
  const index = Math.floor((y - layout.minY) / layout.cellSize);
  return Math.min(layout.rows - 1, Math.max(0, index));
}

export function buildPointGrid(xs: Float64Array, ys: Float64Array, count: number): CellGrid {
  const layout = layoutFor(boundsOfPoints(xs, ys, count), count);
  const cellOf = new Int32Array(count);
  const starts = new Int32Array(layout.cols * layout.rows + 1);
  for (let i = 0; i < count; i += 1) {
    const cell = row(layout, ys[i] ?? 0) * layout.cols + column(layout, xs[i] ?? 0);
    cellOf[i] = cell;
    starts[cell + 1] = (starts[cell + 1] ?? 0) + 1;
  }
  prefixSum(starts);
  const fill = starts.slice(0, starts.length - 1);
  const entries = new Int32Array(count);
  for (let i = 0; i < count; i += 1) {
    const cell = cellOf[i] ?? 0;
    const at = fill[cell] ?? 0;
    entries[at] = i;
    fill[cell] = at + 1;
  }
  return { ...layout, starts, entries, wide: new Int32Array(0) };
}

// `boxes` holds minX, minY, maxX, maxY per entry.
export function buildBoxGrid(boxes: Float64Array, count: number): CellGrid {
  const layout = layoutFor(boundsOfBoxes(boxes, count), count);
  const starts = new Int32Array(layout.cols * layout.rows + 1);
  const wide: number[] = [];
  forEachBoxCell(
    layout,
    boxes,
    count,
    (cell) => {
      starts[cell + 1] = (starts[cell + 1] ?? 0) + 1;
    },
    wide,
  );
  prefixSum(starts);
  const fill = starts.slice(0, starts.length - 1);
  const entries = new Int32Array(starts[starts.length - 1] ?? 0);
  forEachBoxCell(layout, boxes, count, (cell, entry) => {
    const at = fill[cell] ?? 0;
    entries[at] = entry;
    fill[cell] = at + 1;
  });
  return { ...layout, starts, entries, wide: Int32Array.from(wide) };
}

function forEachBoxCell(
  layout: Layout,
  boxes: Float64Array,
  count: number,
  visit: (cell: number, entry: number) => void,
  wide?: number[],
): void {
  for (let i = 0; i < count; i += 1) {
    const c0 = column(layout, boxes[i * 4] ?? 0);
    const r0 = row(layout, boxes[i * 4 + 1] ?? 0);
    const c1 = column(layout, boxes[i * 4 + 2] ?? 0);
    const r1 = row(layout, boxes[i * 4 + 3] ?? 0);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > WIDE_CELL_LIMIT) {
      wide?.push(i);
      continue;
    }
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) visit(r * layout.cols + c, i);
    }
  }
}

// Visit every entry filed in a cell overlapping `box`, plus the wide list.
// A box entry can be visited more than once; callers that care deduplicate.
// Stops early, returning false, once `visit` returns false (the scan budget).
export function forEachEntryNear(
  grid: CellGrid,
  box: Box,
  visit: (entry: number) => boolean,
): boolean {
  if (!visitAll(grid.wide, visit)) return false;
  if (!overlapsGrid(grid, box)) return true;
  const range: CellRange = {
    c0: column(grid, box.minX),
    c1: column(grid, box.maxX),
    r0: row(grid, box.minY),
    r1: row(grid, box.maxY),
  };
  // A query wider than the data (a far zoomed-out, tiny object) would walk more
  // empty cells than there are entries; reading the entries straight is cheaper.
  if ((range.c1 - range.c0 + 1) * (range.r1 - range.r0 + 1) > grid.entries.length) {
    return visitAll(grid.entries, visit);
  }
  return visitCells(grid, range, visit);
}

type CellRange = {
  readonly c0: number;
  readonly c1: number;
  readonly r0: number;
  readonly r1: number;
};

function visitAll(entries: Int32Array, visit: (entry: number) => boolean): boolean {
  for (const entry of entries) if (!visit(entry)) return false;
  return true;
}

function visitCells(grid: CellGrid, range: CellRange, visit: (entry: number) => boolean): boolean {
  for (let r = range.r0; r <= range.r1; r += 1) {
    for (let c = range.c0; c <= range.c1; c += 1) {
      const cell = r * grid.cols + c;
      const end = grid.starts[cell + 1] ?? 0;
      for (let at = grid.starts[cell] ?? 0; at < end; at += 1) {
        if (!visit(grid.entries[at] ?? 0)) return false;
      }
    }
  }
  return true;
}

function overlapsGrid(grid: CellGrid, box: Box): boolean {
  return (
    box.maxX >= grid.minX &&
    box.maxY >= grid.minY &&
    box.minX <= grid.minX + grid.cols * grid.cellSize &&
    box.minY <= grid.minY + grid.rows * grid.cellSize
  );
}

function prefixSum(values: Int32Array): void {
  for (let i = 1; i < values.length; i += 1) values[i] = (values[i] ?? 0) + (values[i - 1] ?? 0);
}

function boundsOfPoints(xs: Float64Array, ys: Float64Array, count: number): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    const x = xs[i] ?? 0;
    const y = ys[i] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return count === 0 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

function boundsOfBoxes(boxes: Float64Array, count: number): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    minX = Math.min(minX, boxes[i * 4] ?? 0);
    minY = Math.min(minY, boxes[i * 4 + 1] ?? 0);
    maxX = Math.max(maxX, boxes[i * 4 + 2] ?? 0);
    maxY = Math.max(maxY, boxes[i * 4 + 3] ?? 0);
  }
  return count === 0 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}
