// The carved stock as an STL solid (ADR-487), for another program to read:
// one closed surface of the stock's top as carved, its sides and its bottom,
// in the program's millimetres.
//
// The top has a vertex at every cell's centre, as the 3D view draws it, and
// at the stock's edge the outer vertices sit on the edge, so the solid is the
// stock's full size. Cells cut through the bottom leave a hole, walled round.
// Each row of squares is split into runs: a flat run (the uncut top, a
// pocket's floor) is stitched as one strip between the vertices its edges
// need, and so is each row of the bottom, so a sheet mostly left flat is a
// small file. A run's edge keeps every vertex any neighbouring run or wall
// has on it, so no vertex sits part way along another triangle's edge and
// the surface is closed.

import type { StockCells } from './stock-design-target';

/** The carved stock: its grid, each cell's depth and the stock's bottom. */
export type StockSolid = StockCells & {
  /** The stock's size; the last cell on each side may be shorter than the rest. */
  readonly widthMm: number;
  readonly heightMm: number;
  readonly depth: Float32Array;
  readonly bottomZ: number;
};

export type StockStl = { readonly bytes: ArrayBuffer; readonly triangles: number };

// A cell this far below the bottom is cut through, as the 3D view draws it.
const THROUGH_MM = 1e-3;
const HEADER_BYTES = 80;
const TRIANGLE_BYTES = 50;
const HEADER = 'KerfDesk carved stock, millimetres';

type Vertex = { readonly x: number; readonly y: number; readonly z: number };

// Squares between vertex columns `start` and `end` of one row: flat at
// `height`, or one square that is not flat (height null).
type Run = { readonly start: number; end: number; readonly height: number | null };

type SolidGrid = {
  readonly columns: number;
  readonly rows: number;
  /** Each vertex's height; NaN where the cell is cut through. */
  readonly heights: Float32Array;
  readonly bottomZ: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
};

// One row of squares, between vertex rows `row` and `row + 1`, and the
// vertices each of those two vertex rows needs on the top and on the bottom.
type Band = {
  readonly row: number;
  readonly runs: ReadonlyArray<Run>;
  readonly lower: Uint8Array;
  readonly upper: Uint8Array;
  readonly floorLower: Uint8Array;
  readonly floorUpper: Uint8Array;
};

/** The carved stock as a binary STL; null when nothing of it is left. */
export function stockToStl(stock: StockSolid): StockStl | null {
  if (stock.widthCells < 2 || stock.heightCells < 2) return null;
  const grid = solidGrid(stock);
  const out = createStlWriter();
  let below: Run[] = [];
  let here = quadRuns(grid, 0);
  for (let row = 0; row < grid.rows - 1; row += 1) {
    const above = row + 2 < grid.rows ? quadRuns(grid, row + 1) : [];
    const lower = runEnds(grid.columns, below, here);
    const upper = runEnds(grid.columns, here, above);
    const floorLower = floorEnds(grid, lower, row, [below, here]);
    const floorUpper = floorEnds(grid, upper, row + 1, [here, above]);
    meshBand(grid, out, { row, runs: here, lower, upper, floorLower, floorUpper });
    below = here;
    here = above;
  }
  return out.count() === 0 ? null : out.finish();
}

function solidGrid(stock: StockSolid): SolidGrid {
  const columns = stock.widthCells;
  const rows = stock.heightCells;
  const heights = new Float32Array(columns * rows);
  for (let at = 0; at < heights.length; at += 1) {
    const depth = stock.depth[at] ?? 0;
    heights[at] = depth < stock.bottomZ - THROUGH_MM ? NaN : Math.max(depth, stock.bottomZ);
  }
  return {
    columns,
    rows,
    heights,
    bottomZ: stock.bottomZ,
    x: vertexPlaces(stock.originX, stock.mmPerCell, columns, stock.widthMm),
    y: vertexPlaces(stock.originY, stock.mmPerCell, rows, stock.heightMm),
  };
}

// Each cell's centre, with the first and last on the stock's edges.
function vertexPlaces(origin: number, mmPerCell: number, count: number, sizeMm: number) {
  const places = new Float64Array(count);
  for (let at = 0; at < count; at += 1) places[at] = origin + (at + 0.5) * mmPerCell;
  places[0] = origin;
  places[count - 1] = origin + sizeMm;
  return places;
}

function heightAt(grid: SolidGrid, column: number, row: number): number {
  return grid.heights[row * grid.columns + column] ?? NaN;
}

function vertexAt(grid: SolidGrid, column: number, row: number, z: number): Vertex {
  return { x: grid.x[column] ?? 0, y: grid.y[row] ?? 0, z };
}

// A square is solid when none of its corners is cut through.
function quadSolid(grid: SolidGrid, column: number, row: number): boolean {
  if (column < 0 || row < 0 || column >= grid.columns - 1 || row >= grid.rows - 1) return false;
  return !Number.isNaN(
    heightAt(grid, column, row) +
      heightAt(grid, column + 1, row) +
      heightAt(grid, column, row + 1) +
      heightAt(grid, column + 1, row + 1),
  );
}

// The square's height when its four corners are level, else null.
function flatHeight(grid: SolidGrid, column: number, row: number): number | null {
  const height = heightAt(grid, column, row);
  const level =
    heightAt(grid, column + 1, row) === height &&
    heightAt(grid, column, row + 1) === height &&
    heightAt(grid, column + 1, row + 1) === height;
  return level ? height : null;
}

function quadRuns(grid: SolidGrid, row: number): Run[] {
  const runs: Run[] = [];
  for (let column = 0; column < grid.columns - 1; column += 1) {
    if (!quadSolid(grid, column, row)) continue;
    const height = flatHeight(grid, column, row);
    const last = runs.at(-1);
    if (height !== null && last?.end === column && last.height === height) last.end = column + 1;
    else runs.push({ start: column, end: column + 1, height });
  }
  return runs;
}

// The vertices a vertex row needs: every end of a run on either side of it.
// A wall starts or stops only where the squares beside it do, so this holds
// the walls' ends too.
function runEnds(
  columns: number,
  ...sides: ReadonlyArray<ReadonlyArray<Pick<Run, 'start' | 'end'>>>
): Uint8Array {
  const ends = new Uint8Array(columns);
  for (const runs of sides) {
    for (const run of runs) {
      ends[run.start] = 1;
      ends[run.end] = 1;
    }
  }
  return ends;
}

// The bottom needs fewer: the ends of the solid stretches either side, and
// the walls' vertices where a wall stands on this vertex row.
function floorEnds(
  grid: SolidGrid,
  topEnds: Uint8Array,
  row: number,
  sides: readonly [ReadonlyArray<Run>, ReadonlyArray<Run>],
): Uint8Array {
  const ends = runEnds(grid.columns, stretches(sides[0]), stretches(sides[1]));
  const walled = (column: number): boolean =>
    quadSolid(grid, column, row - 1) !== quadSolid(grid, column, row);
  for (let column = 0; column < grid.columns; column += 1) {
    if (topEnds[column] === 1 && (walled(column - 1) || walled(column))) ends[column] = 1;
  }
  return ends;
}

function meshBand(grid: SolidGrid, out: StlWriter, band: Band): void {
  const { row } = band;
  for (const run of band.runs) {
    const lower = surface(grid, endColumns(band.lower, run), row);
    const upper = surface(grid, endColumns(band.upper, run), row + 1);
    stitch(out, lower, upper, true);
  }
  for (const stretch of stretches(band.runs)) {
    const front = floor(grid, endColumns(band.floorLower, stretch), row);
    const back = floor(grid, endColumns(band.floorUpper, stretch), row + 1);
    stitch(out, front, back, false);
    walls(grid, out, row, endColumns(band.lower, stretch), endColumns(band.upper, stretch));
  }
}

// The columns along one edge of a run that have a vertex, left to right.
function endColumns(ends: Uint8Array, run: Pick<Run, 'start' | 'end'>): number[] {
  const columns: number[] = [];
  for (let column = run.start; column <= run.end; column += 1) {
    if (ends[column] === 1) columns.push(column);
  }
  return columns;
}

function surface(grid: SolidGrid, columns: ReadonlyArray<number>, row: number): Vertex[] {
  return columns.map((column) => topAt(grid, column, row));
}

function floor(grid: SolidGrid, columns: ReadonlyArray<number>, row: number): Vertex[] {
  return columns.map((column) => vertexAt(grid, column, row, grid.bottomZ));
}

function topAt(grid: SolidGrid, column: number, row: number): Vertex {
  return vertexAt(grid, column, row, heightAt(grid, column, row));
}

// Triangles between a lower and an upper edge, both left to right, facing up
// or down. Each takes the next vertex from whichever edge is further behind.
function stitch(out: StlWriter, lower: Vertex[], upper: Vertex[], up: boolean): void {
  let i = 0;
  let j = 0;
  for (;;) {
    const a = lower[i];
    const b = upper[j];
    const nextLower = lower[i + 1];
    const nextUpper = upper[j + 1];
    if (a === undefined || b === undefined) return;
    if (nextLower !== undefined && !(nextUpper !== undefined && nextUpper.x < nextLower.x)) {
      out.add(a, up ? nextLower : b, up ? b : nextLower);
      i += 1;
    } else if (nextUpper !== undefined) {
      out.add(a, up ? nextUpper : b, up ? b : nextUpper);
      j += 1;
    } else {
      return;
    }
  }
}

// Solid squares side by side in one row, whatever their shape.
function stretches(runs: ReadonlyArray<Run>): Array<Pick<Run, 'start' | 'end'>> {
  const merged: Array<{ start: number; end: number }> = [];
  for (const run of runs) {
    const last = merged.at(-1);
    if (last?.end === run.start) last.end = run.end;
    else merged.push({ start: run.start, end: run.end });
  }
  return merged;
}

// Walls down to the bottom wherever the squares beside a stretch are not
// solid: in front, behind, and at its two ends. Between two neighbouring
// vertices the squares beside are all solid or all not: they change only at
// a run's end, and every run's end has a vertex.
function walls(
  grid: SolidGrid,
  out: StlWriter,
  row: number,
  front: ReadonlyArray<number>,
  back: ReadonlyArray<number>,
): void {
  for (let at = 0; at + 1 < front.length; at += 1) {
    const a = front[at] ?? 0;
    const b = front[at + 1] ?? 0;
    if (!quadSolid(grid, a, row - 1)) wall(out, grid, topAt(grid, a, row), topAt(grid, b, row));
  }
  for (let at = back.length - 1; at > 0; at -= 1) {
    const a = back[at - 1] ?? 0;
    const b = back[at] ?? 0;
    if (!quadSolid(grid, a, row + 1)) {
      wall(out, grid, topAt(grid, b, row + 1), topAt(grid, a, row + 1));
    }
  }
  const start = front[0] ?? 0;
  const end = front.at(-1) ?? 0;
  wall(out, grid, topAt(grid, start, row + 1), topAt(grid, start, row));
  wall(out, grid, topAt(grid, end, row), topAt(grid, end, row + 1));
}

// A wall from the top edge p to q down to the bottom, facing to the right of
// p to q seen from above.
function wall(out: StlWriter, grid: SolidGrid, p: Vertex, q: Vertex): void {
  const pBottom = { ...p, z: grid.bottomZ };
  const qBottom = { ...q, z: grid.bottomZ };
  out.add(pBottom, qBottom, q);
  out.add(pBottom, q, p);
}

type StlWriter = {
  readonly add: (a: Vertex, b: Vertex, c: Vertex) => void;
  readonly count: () => number;
  readonly finish: () => StockStl;
};

// Binary STL: an 80-byte header, the triangle count, then each triangle's
// normal and corners as little-endian floats. A triangle with no area is
// left out: its edges are already shared by the triangles either side.
function createStlWriter(): StlWriter {
  let bytes = new ArrayBuffer(HEADER_BYTES + 4 + TRIANGLE_BYTES * 4096);
  let view = new DataView(bytes);
  let count = 0;
  const grow = (): void => {
    const next = new ArrayBuffer(bytes.byteLength * 2);
    new Uint8Array(next).set(new Uint8Array(bytes));
    bytes = next;
    view = new DataView(bytes);
  };
  return {
    add: (a, b, c) => {
      const normal = unitNormal(a, b, c);
      if (normal === null) return;
      let at = HEADER_BYTES + 4 + count * TRIANGLE_BYTES;
      if (at + TRIANGLE_BYTES > bytes.byteLength) grow();
      for (const value of [
        normal.x,
        normal.y,
        normal.z,
        a.x,
        a.y,
        a.z,
        b.x,
        b.y,
        b.z,
        c.x,
        c.y,
        c.z,
      ]) {
        view.setFloat32(at, value, true);
        at += 4;
      }
      count += 1;
    },
    count: () => count,
    finish: () => {
      const header = new TextEncoder().encode(HEADER);
      new Uint8Array(bytes, 0, HEADER_BYTES).set(header.subarray(0, HEADER_BYTES));
      view.setUint32(HEADER_BYTES, count, true);
      return { bytes: bytes.slice(0, HEADER_BYTES + 4 + count * TRIANGLE_BYTES), triangles: count };
    },
  };
}

function unitNormal(a: Vertex, b: Vertex, c: Vertex): Vertex | null {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const length = Math.hypot(x, y, z);
  return length === 0 ? null : { x: x / length, y: y / length, z: z / length };
}
