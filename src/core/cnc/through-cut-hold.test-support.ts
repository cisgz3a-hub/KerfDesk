// Independent hold check for through-cut profiles (ADR-140 Amendment 2).
//
// It reads only the emitted G-code, never the planner under test: it stamps
// every cutter position that reaches the full depth onto a grid, flood-fills the
// stock left in the bottom layer from the sheet border, and reports each piece
// the fill cannot reach: a part, a slug or a ring of waste that no bridge joins
// to the sheet. Cells the cutter only touches count as cut, so the check errs
// toward "loose".

import type { Vec2 } from '../scene';

type Point3 = { readonly x: number; readonly y: number; readonly z: number };

/** Every feed position of `gcode`, arcs flattened, at most `stepMm` apart. */
export function feedSamples(gcode: string, stepMm: number): ReadonlyArray<Point3> {
  const samples: Point3[] = [];
  let at: Point3 = { x: 0, y: 0, z: 0 };
  let motion = 0;
  for (const raw of gcode.split(/\r?\n/)) {
    const words = gcodeWords(raw);
    const codes = words.filter(([letter]) => letter === 'G').map(([, value]) => value);
    if (codes.includes(91) || codes.includes(20)) throw new Error(`unsupported mode: ${raw}`);
    if (codes.some((code) => NON_MOTION_CODES.has(code))) continue;
    motion = codes.find((code) => code >= 0 && code <= 3) ?? motion;
    const to = axisTarget(words, at);
    if (to === null) continue;
    if (motion === 1) samples.push(...lineSamples(at, to, stepMm));
    if (motion === 2 || motion === 3) {
      const center = { x: at.x + wordValue(words, 'I', 0), y: at.y + wordValue(words, 'J', 0) };
      samples.push(...arcSamples(at, to, center, motion === 2, stepMm));
    }
    at = to;
  }
  return samples;
}

// Dwell, offsets, homing and machine-frame moves carry axis words that are not
// a cut from the current position.
const NON_MOTION_CODES: ReadonlySet<number> = new Set([4, 10, 28, 30, 53, 92]);

type Words = ReadonlyArray<readonly [string, number]>;

function wordValue(words: Words, letter: string, fallback: number): number {
  return words.find(([key]) => key === letter)?.[1] ?? fallback;
}

function axisTarget(words: Words, at: Point3): Point3 | null {
  if (!words.some(([letter]) => letter === 'X' || letter === 'Y' || letter === 'Z')) return null;
  return {
    x: wordValue(words, 'X', at.x),
    y: wordValue(words, 'Y', at.y),
    z: wordValue(words, 'Z', at.z),
  };
}

/**
 * The area, in mm², of every piece of bottom-layer stock that no bridge joins to
 * the sheet once every cut reaching `depthMm` deep has run. Largest first.
 */
export function loosePiecesMm2(
  gcode: string,
  options: { readonly depthMm: number; readonly cutterDiameterMm: number; readonly cellMm: number },
): ReadonlyArray<number> {
  const { depthMm, cutterDiameterMm, cellMm } = options;
  const deep = feedSamples(gcode, cellMm).filter((sample) => sample.z <= -depthMm + 0.01);
  if (deep.length === 0) return [];
  const grid = stockGrid(deep, cellMm);
  const reach = cutterDiameterMm / 2 + cellMm * Math.SQRT1_2;
  for (const sample of deep) stampDisc(grid, sample, reach);
  const reached = new Uint8Array(grid.width * grid.height);
  fill(grid, reached, borderCells(grid));
  const pieces: number[] = [];
  for (let index = 0; index < reached.length; index += 1) {
    if (reached[index] === 1 || grid.cut[index] === 1) continue;
    pieces.push(fill(grid, reached, [index]) * cellMm * cellMm);
  }
  return pieces.sort((a, b) => b - a);
}

type StockGrid = {
  readonly minX: number;
  readonly minY: number;
  readonly cellMm: number;
  readonly width: number;
  readonly height: number;
  readonly cut: Uint8Array;
};

// A sheet margin wider than any slot keeps the border solid stock.
const SHEET_MARGIN_MM = 10;

function stockGrid(points: ReadonlyArray<Vec2>, cellMm: number): StockGrid {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x - SHEET_MARGIN_MM);
    minY = Math.min(minY, point.y - SHEET_MARGIN_MM);
    maxX = Math.max(maxX, point.x + SHEET_MARGIN_MM);
    maxY = Math.max(maxY, point.y + SHEET_MARGIN_MM);
  }
  const width = Math.ceil((maxX - minX) / cellMm);
  const height = Math.ceil((maxY - minY) / cellMm);
  return { minX, minY, cellMm, width, height, cut: new Uint8Array(width * height) };
}

function stampDisc(grid: StockGrid, center: Vec2, radiusMm: number): void {
  const { minX, minY, cellMm, width, height } = grid;
  const fromI = Math.max(0, Math.floor((center.x - radiusMm - minX) / cellMm));
  const toI = Math.min(width - 1, Math.floor((center.x + radiusMm - minX) / cellMm));
  const fromJ = Math.max(0, Math.floor((center.y - radiusMm - minY) / cellMm));
  const toJ = Math.min(height - 1, Math.floor((center.y + radiusMm - minY) / cellMm));
  for (let j = fromJ; j <= toJ; j += 1) {
    const dy = minY + (j + 0.5) * cellMm - center.y;
    for (let i = fromI; i <= toI; i += 1) {
      const dx = minX + (i + 0.5) * cellMm - center.x;
      if (dx * dx + dy * dy <= radiusMm * radiusMm) grid.cut[j * width + i] = 1;
    }
  }
}

function borderCells(grid: StockGrid): ReadonlyArray<number> {
  const { width, height } = grid;
  const cells: number[] = [];
  for (let i = 0; i < width; i += 1) cells.push(i, (height - 1) * width + i);
  for (let j = 0; j < height; j += 1) cells.push(j * width, j * width + width - 1);
  return cells;
}

// Four-connected fill through uncut cells; returns how many cells it newly reached.
function fill(grid: StockGrid, reached: Uint8Array, seeds: ReadonlyArray<number>): number {
  const { width, height, cut } = grid;
  const stack: number[] = [];
  let count = 0;
  const visit = (index: number): void => {
    if (reached[index] === 1 || cut[index] === 1) return;
    reached[index] = 1;
    count += 1;
    stack.push(index);
  };
  for (const seed of seeds) visit(seed);
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const i = index % width;
    if (i > 0) visit(index - 1);
    if (i < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index < (height - 1) * width) visit(index + width);
  }
  return count;
}

function gcodeWords(raw: string): Words {
  const text = raw
    .replace(/\(.*?\)/g, '')
    .replace(/;.*$/, '')
    .toUpperCase();
  return [...text.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)].map(
    (match) => [match[1] as string, Number(match[2])] as const,
  );
}

function lineSamples(from: Point3, to: Point3, stepMm: number): ReadonlyArray<Point3> {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const steps = Math.max(1, Math.ceil(length / stepMm));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t,
    };
  });
}

function arcSamples(
  from: Point3,
  to: Point3,
  center: Vec2,
  clockwise: boolean,
  stepMm: number,
): ReadonlyArray<Point3> {
  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  const start = Math.atan2(from.y - center.y, from.x - center.x);
  let end = Math.atan2(to.y - center.y, to.x - center.x);
  if (clockwise) while (end >= start - 1e-12) end -= 2 * Math.PI;
  else while (end <= start + 1e-12) end += 2 * Math.PI;
  const sweep = end - start;
  const steps = Math.max(8, Math.ceil((Math.abs(sweep) * radius) / stepMm));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const angle = start + sweep * t;
    return {
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
      z: from.z + (to.z - from.z) * t,
    };
  });
}
