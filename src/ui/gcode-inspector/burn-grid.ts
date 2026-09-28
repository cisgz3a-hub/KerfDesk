// The burn a laser program leaves, for the burn preview (ADR-487). It runs in
// its own worker (burn-worker.ts), as playback runs. Every move the laser is
// on for lays its beam's width of burn along it. How dark a pass burns
// depends on the energy it puts into each square millimetre, its power and
// speed on the laser's watts and beam, against the material's full burn
// (ADR-501, burn-energy.ts); or on its power alone, as LightBurn's preview
// shades. Passes over the same place darken it further. Each cell keeps the
// burn's optical density, so a cell one pass at the full burn covers is left
// with 8% of the surface's light, and beams narrower than a cell darken it by
// the share of it they cover.
//
// On a rotary, program Y turns the work: one revolution is `wrapYMm` of Y,
// and the grid's rows go once round it, so a job longer than one turn burns
// over its own start, as it would on the machine.

import { SEG_KIND } from '../../core/gcode-view';
import { doseDensity, passDoseJPerMm2, powerDensity } from './burn-energy';
import type { StockChange, StockTarget } from './stock-carving';

/** What decides how dark a pass burns (ADR-501). */
export type BurnShading =
  | { readonly by: 'power' }
  | {
      readonly by: 'energy';
      /** The laser head's optical power. */
      readonly opticalPowerW: number;
      /** Joules per mm² that burn the material fully. */
      readonly fullDoseJPerMm2: number;
    };

/** The laser the program runs on, and the work it burns. */
export type BurnLaser = {
  /** The S value that is full power: the controller's $30. */
  readonly maxPowerS: number;
  /** The beam's width on the work. */
  readonly spotMm: number;
  /** Machine Y that turns the work once round a rotary; absent on a flat bed. */
  readonly wrapYMm?: number;
  /** By power alone when absent. */
  readonly shading?: BurnShading;
};

export type BurnMoves = {
  readonly segmentCount: number;
  readonly positions: Float32Array;
  readonly segKind: Uint8Array;
  readonly segPower: Float32Array;
  /** Each move's programmed feed, mm/min. */
  readonly segFeed: Float32Array;
};

/** Where the burn is: its first cell's corner, its cells and the surface's height. */
export type BurnLayout = {
  readonly originX: number;
  readonly originY: number;
  readonly mmPerCell: number;
  readonly columns: number;
  readonly rows: number;
  /** The height the laser burns at: the first surface the program burns. */
  readonly z: number;
  /** One revolution of the rotary, when the burn wraps round one. */
  readonly wrapYMm?: number;
};

export type Burner = {
  readonly layout: BurnLayout;
  /** Each cell's darkness, 0 bare to 255 black, row by row from the front. */
  readonly darkness: Uint8Array;
  readonly burnTo: (target: StockTarget) => StockChange | null;
};

const MAX_CELLS = 4_000_000;
// The darkness goes to the GPU as one texture; every WebGL 2 takes this many a side.
const MAX_CELLS_A_SIDE = 2048;
const MIN_CELL_MM = 0.05;
const MARGIN_MM = 1;
const FLOATS_PER_MOVE = 6;

/** Whether a move burns: the laser is on and moving. */
export function burnsAt(moves: BurnMoves, index: number): boolean {
  return moves.segKind[index] === SEG_KIND.cut && (moves.segPower[index] ?? 0) > 0;
}

/** Whether the program burns anything at all. */
export function burnsAnything(moves: BurnMoves): boolean {
  for (let index = 0; index < moves.segmentCount; index += 1) {
    if (burnsAt(moves, index)) return true;
  }
  return false;
}

/** The least and most energy the program's burning moves put in, J/mm². */
export function burnDoseRange(
  moves: BurnMoves,
  laser: BurnLaser,
  opticalPowerW: number,
): { readonly min: number; readonly max: number } | null {
  let range: { min: number; max: number } | null = null;
  for (let index = 0; index < moves.segmentCount; index += 1) {
    if (!burnsAt(moves, index)) continue;
    const dose = moveDoseJPerMm2(moves, laser, index, opticalPowerW);
    range ??= { min: dose, max: dose };
    range.min = Math.min(range.min, dose);
    range.max = Math.max(range.max, dose);
  }
  return range;
}

export function burnLayout(moves: BurnMoves, laser: BurnLaser): BurnLayout | null {
  const burn = burnExtent(moves);
  if (burn === null) return null;
  const room = laser.spotMm + MARGIN_MM;
  const widthMm = burn.maxX - burn.minX + 2 * room;
  const wrap = laser.wrapYMm !== undefined && laser.wrapYMm > 0 ? laser.wrapYMm : undefined;
  const heightMm = wrap ?? burn.maxY - burn.minY + 2 * room;
  let mmPerCell = Math.max(
    MIN_CELL_MM,
    Math.sqrt((widthMm * heightMm) / MAX_CELLS),
    widthMm / MAX_CELLS_A_SIDE,
    heightMm / MAX_CELLS_A_SIDE,
  );
  // Round the work, the rows go exactly once round it.
  if (wrap !== undefined) mmPerCell = wrap / Math.ceil(wrap / mmPerCell);
  return {
    originX: burn.minX - room,
    originY: wrap === undefined ? burn.minY - room : burn.minY,
    mmPerCell,
    columns: Math.max(1, Math.ceil(widthMm / mmPerCell)),
    rows: Math.max(1, Math.round(heightMm / mmPerCell)),
    z: burn.maxZ,
    ...(wrap === undefined ? {} : { wrapYMm: wrap }),
  };
}

export function createBurner(layout: BurnLayout, moves: BurnMoves, laser: BurnLaser): Burner {
  const cells = layout.columns * layout.rows;
  const density = new Float32Array(cells);
  const darkness = new Uint8Array(cells);
  const canvas = burnCanvas(layout, density);
  let done: StockTarget = { index: 0, fraction: 0 };
  return {
    layout,
    darkness,
    burnTo: (target) => {
      const restart = before(target, done);
      if (restart) {
        density.fill(0);
        done = { index: 0, fraction: 0 };
      }
      const rows = { first: Infinity, last: -Infinity };
      burnRange(moves, laser, canvas, done, target, rows);
      done = target;
      const change = restart
        ? { firstRow: 0, rowCount: layout.rows }
        : rows.first > rows.last
          ? null
          : { firstRow: rows.first, rowCount: rows.last - rows.first + 1 };
      if (change !== null) shade(layout, density, darkness, change);
      return change;
    },
  };
}

type Rows = { first: number; last: number };
// The grid burn is laid into: its cell size, and adding burn under a point.
type BurnCanvas = {
  readonly cell: number;
  readonly deposit: (x: number, y: number, amount: number, rows: Rows) => void;
};
type Point = { readonly x: number; readonly y: number };

// Burns each move from where the last burn stopped, part way along a move
// included, up to the target: nothing is burned twice.
function burnRange(
  moves: BurnMoves,
  laser: BurnLaser,
  canvas: BurnCanvas,
  from: StockTarget,
  to: StockTarget,
  rows: Rows,
): void {
  const last = Math.min(to.index, moves.segmentCount - 1);
  for (let index = from.index; index <= last; index += 1) {
    const start = index === from.index ? from.fraction : 0;
    const end = index < to.index ? 1 : to.fraction;
    if (end <= start || !burnsAt(moves, index)) continue;
    const at = index * FLOATS_PER_MOVE;
    const a = { x: moves.positions[at] ?? 0, y: moves.positions[at + 1] ?? 0 };
    const b = { x: moves.positions[at + 3] ?? 0, y: moves.positions[at + 4] ?? 0 };
    const density = passDensity(moves, laser, index);
    burnLine(canvas, lerp(a, b, start), lerp(a, b, end), density, laser.spotMm, rows);
  }
}

/** The share of full power a move burns at. */
export function movePower(moves: BurnMoves, laser: BurnLaser, index: number): number {
  return Math.min(1, (moves.segPower[index] ?? 0) / Math.max(laser.maxPowerS, 1e-9));
}

/** Joules per mm² a move puts in, on a laser of this optical power. */
export function moveDoseJPerMm2(
  moves: BurnMoves,
  laser: BurnLaser,
  index: number,
  opticalPowerW: number,
): number {
  const pass = { power: movePower(moves, laser, index), feedMmPerMin: moves.segFeed[index] ?? 0 };
  return passDoseJPerMm2({ opticalPowerW, beamMm: laser.spotMm }, pass);
}

// The optical density one pass of this move leaves.
function passDensity(moves: BurnMoves, laser: BurnLaser, index: number): number {
  const shading = laser.shading;
  if (shading === undefined || shading.by === 'power') {
    return powerDensity(movePower(moves, laser, index));
  }
  const dose = moveDoseJPerMm2(moves, laser, index, shading.opticalPowerW);
  return doseDensity(dose, shading.fullDoseJPerMm2);
}

// Lays a beam `spotMm` wide along a line, in steps of half a cell, and across
// it in lines a cell apart where the beam is wider than a cell.
function burnLine(
  canvas: BurnCanvas,
  a: Point,
  b: Point,
  density: number,
  spotMm: number,
  rows: Rows,
): void {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0 || density <= 0) return;
  const { cell } = canvas;
  const steps = Math.max(1, Math.ceil(length / (cell / 2)));
  const across = Math.max(1, Math.round(spotMm / cell));
  const amount = (density * (length / steps) * spotMm) / (cell * cell * across);
  const nx = -(b.y - a.y) / length;
  const ny = (b.x - a.x) / length;
  for (let lane = 0; lane < across; lane += 1) {
    const offset = (lane - (across - 1) / 2) * (spotMm / across);
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps;
      const x = a.x + (b.x - a.x) * t + nx * offset;
      const y = a.y + (b.y - a.y) * t + ny * offset;
      canvas.deposit(x, y, amount, rows);
    }
  }
}

// Adds burn to the cell under a point, wrapping round a rotary.
function burnCanvas(layout: BurnLayout, density: Float32Array): BurnCanvas {
  const { originX, originY, mmPerCell, columns, rows: rowCount, wrapYMm } = layout;
  const deposit = (x: number, y: number, amount: number, rows: Rows): void => {
    const column = Math.floor((x - originX) / mmPerCell);
    let along = y - originY;
    if (wrapYMm !== undefined) along -= Math.floor(along / wrapYMm) * wrapYMm;
    const row = Math.min(rowCount - 1, Math.floor(along / mmPerCell));
    if (column < 0 || column >= columns || row < 0) return;
    const at = row * columns + column;
    density[at] = (density[at] ?? 0) + amount;
    if (row < rows.first) rows.first = row;
    if (row > rows.last) rows.last = row;
  };
  return { cell: mmPerCell, deposit };
}

function shade(
  layout: BurnLayout,
  density: Float32Array,
  darkness: Uint8Array,
  change: StockChange,
): void {
  const from = change.firstRow * layout.columns;
  const to = (change.firstRow + change.rowCount) * layout.columns;
  for (let at = from; at < to; at += 1) {
    darkness[at] = Math.round(255 * (1 - Math.exp(-(density[at] ?? 0))));
  }
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function before(target: StockTarget, done: StockTarget): boolean {
  return (
    target.index < done.index || (target.index === done.index && target.fraction < done.fraction)
  );
}

function burnExtent(
  moves: BurnMoves,
): { minX: number; maxX: number; minY: number; maxY: number; maxZ: number } | null {
  let extent: { minX: number; maxX: number; minY: number; maxY: number; maxZ: number } | null =
    null;
  for (let index = 0; index < moves.segmentCount; index += 1) {
    if (!burnsAt(moves, index)) continue;
    extent ??= {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
      maxZ: -Infinity,
    };
    for (const at of [index * FLOATS_PER_MOVE, index * FLOATS_PER_MOVE + 3]) {
      const x = moves.positions[at] ?? 0;
      const y = moves.positions[at + 1] ?? 0;
      extent.minX = Math.min(extent.minX, x);
      extent.maxX = Math.max(extent.maxX, x);
      extent.minY = Math.min(extent.minY, y);
      extent.maxY = Math.max(extent.maxY, y);
      extent.maxZ = Math.max(extent.maxZ, moves.positions[at + 2] ?? 0);
    }
  }
  return extent;
}
