// Perceptual test harness — emitted raster G-code → burn-density field.
//
// The vector side of this harness (gcode-rasterize.ts) re-inks emitted G-code
// into a BINARY mask: a pixel is burned or it is not. That is the right
// question for a cut contour and the wrong one for an image engrave, where the
// entire point is that S modulates across a sweep and a dither trades tone for
// dot density. A binary mask scores a solid black burn and a 5%-power ghost
// identically, and scores a dithered mid-grey as either far too dark or far
// too light depending on where the dots happen to land.
//
// So this module accumulates ENERGY instead of coverage. Every G1 move made
// while the laser is armed at S > 0 deposits (S / sMax) × (length of the move
// inside the cell) into a coarse machine-space cell grid. Dividing by the burn
// a cell could receive at full power — one full-width pass for each scan row
// the cell contains — puts every cell on a 0..1 "how dark is this patch"
// scale, directly comparable to the source image's local grey density.
//
// Deliberately NOT clamped to 1: a cell scoring 1.4 means the program asked
// for more energy than the image can justify, which is a real regression the
// metric should surface rather than saturate away.
//
// Restriction, stated rather than hidden: a burn move deposits into the cell
// row of its midpoint Y. That is exact for the raster emitter, whose burn
// moves carry X only (Y changes on the G0 between rows — see
// core/raster/emit-raster.ts), and approximate for anything diagonal. This
// instrument is for raster programs; gcode-rasterize.ts remains the one for
// vector paths.
//
// CALLER CONSTRAINT — keep the cell height an integer multiple of
// lineIntervalMm. Because a scan row is assigned WHOLLY to the cell row
// containing its midpoint, a cell boundary that falls part-way through the
// scan pitch attributes whole rows to the wrong side of it. The error is an
// artefact of the grid, not of the program under test, and it is large enough
// to swamp a real regression: measured on a continuous-tone field at a 1 mm
// scan pitch, 4 mm cells score 0.00012 while 4.5 mm cells score 0.04311 — a
// 360× penalty for perfectly correct output. Choose the scoring window and
// cell count together so the division comes out whole (a suitably aligned
// grid is pinned in gcode-burn-density.test.ts). No check enforces this; a
// misaligned grid is a legitimate thing to ask for, it just answers a
// different question than the one you probably meant.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

import { parseGcodeWord, stripGcodeComment } from '../../core/invariants';
import type { Vec2 } from '../../core/scene';

export type MachineRect = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type DensityField = {
  readonly cellsX: number;
  readonly cellsY: number;
  readonly window: MachineRect;
  // Length cellsX*cellsY. Row-major; cell row 0 is the window's LOW machine Y
  // (machine coordinates, so row 0 is the front of the bed on a front-left
  // origin). index = row*cellsX + col.
  readonly data: Float64Array;
};

export type BurnDensityOptions = {
  // Machine-mm rectangle to score. Make it larger than the artwork so a
  // program that burns outside its bounds shows up rather than being clipped.
  readonly window: MachineRect;
  readonly cellsX: number;
  readonly cellsY: number;
  // The S value the emitter uses for a full-power pixel:
  // round((layer power% / 100) * device.maxPowerS). Passing the wrong value
  // rescales every density, so tests derive it from the same two numbers the
  // compiler does rather than hard-coding it.
  readonly sMax: number;
  // Machine-mm between adjacent scan rows: (bounds.maxY - bounds.minY) /
  // pixelHeight for the compiled raster group.
  readonly lineIntervalMm: number;
};

const RASTERIZED_WORDS = ['G', 'M', 'S', 'X', 'Y'] as const;

type ParserState = {
  position: Vec2;
  motion: 'G0' | 'G1';
  armed: boolean;
  s: number;
};

type CellGeometry = {
  readonly cellWidthMm: number;
  readonly cellHeightMm: number;
  // Burn length × power fraction one cell can absorb at full power.
  readonly capacityMm: number;
};

type Deposit = {
  readonly midY: number;
  readonly xa: number;
  readonly xb: number;
  readonly weight: number;
};

export function gcodeBurnDensity(gcode: string, options: BurnDensityOptions): DensityField {
  validate(options);
  const geometry = cellGeometry(options);
  const accumulated = new Float64Array(options.cellsX * options.cellsY);
  const state: ParserState = { position: { x: 0, y: 0 }, motion: 'G0', armed: false, s: 0 };
  for (const rawLine of gcode.split('\n')) {
    applyLine(accumulated, options, geometry, state, rawLine);
  }
  for (let i = 0; i < accumulated.length; i += 1) {
    accumulated[i] = (accumulated[i] ?? 0) / geometry.capacityMm;
  }
  return {
    cellsX: options.cellsX,
    cellsY: options.cellsY,
    window: options.window,
    data: accumulated,
  };
}

/** The S value a compiled raster group emits for a fully black pixel. */
export function fullPowerS(powerPercent: number, maxPowerS: number): number {
  return Math.round((powerPercent / 100) * maxPowerS);
}

function cellGeometry(options: BurnDensityOptions): CellGeometry {
  const cellWidthMm = (options.window.maxX - options.window.minX) / options.cellsX;
  const cellHeightMm = (options.window.maxY - options.window.minY) / options.cellsY;
  // How many scan rows a cell spans. Fractional is fine — it is the expected
  // count, and rows the emitter skipped (all-white) are exactly the ones whose
  // absence should read as zero density.
  const rowsPerCell = cellHeightMm / options.lineIntervalMm;
  return { cellWidthMm, cellHeightMm, capacityMm: rowsPerCell * cellWidthMm };
}

function applyLine(
  accumulated: Float64Array,
  options: BurnDensityOptions,
  geometry: CellGeometry,
  state: ParserState,
  rawLine: string,
): void {
  const words = parseWords(stripGcodeComment(rawLine));
  if (words.size === 0) return;
  applyLaserState(state, words);
  applyMotionMode(state, words);
  const next = nextPosition(state.position, words);
  if (next === null) return;
  if (isLaserOnMove(state)) {
    deposit(accumulated, options, geometry, {
      midY: (state.position.y + next.y) / 2,
      xa: state.position.x,
      xb: next.x,
      weight: state.s / options.sMax,
    });
  }
  state.position = next;
}

function deposit(
  accumulated: Float64Array,
  options: BurnDensityOptions,
  geometry: CellGeometry,
  move: Deposit,
): void {
  const row = Math.floor((move.midY - options.window.minY) / geometry.cellHeightMm);
  if (row < 0 || row >= options.cellsY) return;
  const lo = Math.max(options.window.minX, Math.min(move.xa, move.xb));
  const hi = Math.min(options.window.maxX, Math.max(move.xa, move.xb));
  if (hi <= lo) return;
  const firstCol = Math.max(0, Math.floor((lo - options.window.minX) / geometry.cellWidthMm));
  const lastCol = Math.min(
    options.cellsX - 1,
    Math.floor((hi - options.window.minX) / geometry.cellWidthMm),
  );
  for (let col = firstCol; col <= lastCol; col += 1) {
    const cellLo = options.window.minX + col * geometry.cellWidthMm;
    const overlapMm = Math.min(hi, cellLo + geometry.cellWidthMm) - Math.max(lo, cellLo);
    if (overlapMm <= 0) continue;
    const i = row * options.cellsX + col;
    accumulated[i] = (accumulated[i] ?? 0) + move.weight * overlapMm;
  }
}

function applyLaserState(state: ParserState, words: ReadonlyMap<string, number>): void {
  const m = words.get('M');
  if (m === 3 || m === 4) state.armed = true;
  if (m === 5) {
    state.armed = false;
    state.s = 0;
  }
  const nextS = words.get('S');
  if (nextS !== undefined) state.s = nextS;
}

function applyMotionMode(state: ParserState, words: ReadonlyMap<string, number>): void {
  const g = words.get('G');
  if (g === 0) state.motion = 'G0';
  if (g === 1) state.motion = 'G1';
}

function nextPosition(position: Vec2, words: ReadonlyMap<string, number>): Vec2 | null {
  const x = words.get('X');
  const y = words.get('Y');
  if (x === undefined && y === undefined) return null;
  return { x: x ?? position.x, y: y ?? position.y };
}

function isLaserOnMove(state: ParserState): boolean {
  return state.motion === 'G1' && state.armed && state.s > 0;
}

function parseWords(line: string): Map<string, number> {
  const words = new Map<string, number>();
  for (const word of RASTERIZED_WORDS) {
    const value = parseGcodeWord(line, word);
    if (value !== null) words.set(word, value);
  }
  return words;
}

function validate(options: BurnDensityOptions): void {
  if (options.cellsX <= 0 || options.cellsY <= 0) {
    throw new Error(`gcodeBurnDensity: invalid grid ${options.cellsX}×${options.cellsY}`);
  }
  if (options.window.maxX <= options.window.minX || options.window.maxY <= options.window.minY) {
    throw new Error('gcodeBurnDensity: window must have positive extent');
  }
  if (!(options.sMax > 0)) throw new Error('gcodeBurnDensity: sMax must be > 0');
  if (!(options.lineIntervalMm > 0)) {
    throw new Error('gcodeBurnDensity: lineIntervalMm must be > 0');
  }
}
