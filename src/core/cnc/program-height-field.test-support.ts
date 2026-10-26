// An independent measure of an emitted CNC program, for tests that must not
// grade a planner by its own model: its own G-code reader (G0 to G3, G17 I/J
// arcs, M0 sections) and an exact flat-cutter height field. It imports no
// planner, verifier or removal simulator. Adapted from the checker the CNC
// audit v1 F2 refuter wrote (ADR-154 Amendment 4, ADR-153 Amendment 1).

import type { Vec2 } from '../scene';

export type ProgramPoint = Vec2 & { readonly z: number };

export type ProgramMove = {
  readonly a: ProgramPoint;
  readonly b: ProgramPoint;
  readonly rapid: boolean;
  readonly feedMmPerMin: number;
  readonly line: number;
  // Counts the M0 stops before the move: one section per tool.
  readonly section: number;
};

export type HeightField = {
  readonly minX: number;
  readonly minY: number;
  readonly cellMm: number;
  readonly width: number;
  readonly height: number;
  // Lowest Z each cell's centre has been cut to; 0 is the stock top.
  readonly z: Float64Array;
};

export type StockPatch = { readonly areaMm2: number; readonly centre: Vec2 };

// Arcs are read as chords no further than this from the arc.
const ARC_SAGITTA_MM = 0.005;
const UNSUPPORTED_G = new Set([18, 19, 20, 28, 30, 53, 91, 92]);

type BlockWords = {
  readonly words: Readonly<Record<string, number>>;
  readonly gWords: ReadonlyArray<number>;
  readonly stops: number;
};

function blockWords(line: string): BlockWords {
  const text = line
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*$/, '')
    .trim()
    .toUpperCase();
  const words: Record<string, number> = {};
  const gWords: number[] = [];
  let stops = 0;
  for (const word of text.match(/[A-Z]\s*[-+]?(\d+\.?\d*|\.\d+)/g) ?? []) {
    const letter = word[0] as string;
    const value = Number(word.slice(1));
    if (letter === 'G') gWords.push(value);
    else if (letter === 'M') stops += value === 0 ? 1 : 0;
    else words[letter] = value;
  }
  return { words, gWords, stops };
}

function motionMode(gWords: ReadonlyArray<number>, mode: number, line: number): number {
  let next = mode;
  for (const g of gWords) {
    if (g === 0 || g === 1 || g === 2 || g === 3) next = g;
    if (UNSUPPORTED_G.has(g)) throw new Error(`G${g} is not read (line ${line})`);
  }
  return next;
}

export function parseProgramMoves(gcode: string): ProgramMove[] {
  const moves: ProgramMove[] = [];
  let current: ProgramPoint = { x: 0, y: 0, z: 0 };
  let mode = 0;
  let feed = 0;
  let section = 0;
  const lines = gcode.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const { words, gWords, stops } = blockWords(lines[index] ?? '');
    section += stops;
    mode = motionMode(gWords, mode, index + 1);
    feed = words.F ?? feed;
    const next = gWords.includes(4) ? null : endPoint(words, current);
    if (next === null) continue;
    const move = { rapid: mode === 0, feedMmPerMin: feed, line: index + 1, section };
    for (const [a, b] of moveChords(mode, current, next, words)) moves.push({ ...move, a, b });
    current = next;
  }
  return moves;
}

function endPoint(
  words: Readonly<Record<string, number>>,
  current: ProgramPoint,
): ProgramPoint | null {
  const { X: x, Y: y, Z: z } = words;
  return x === undefined && y === undefined && z === undefined
    ? null
    : { x: x ?? current.x, y: y ?? current.y, z: z ?? current.z };
}

function moveChords(
  mode: number,
  from: ProgramPoint,
  to: ProgramPoint,
  words: Readonly<Record<string, number>>,
): Array<[ProgramPoint, ProgramPoint]> {
  return mode === 2 || mode === 3
    ? arcChords(from, to, words.I ?? 0, words.J ?? 0, mode === 3)
    : [[from, to]];
}

function arcChords(
  from: ProgramPoint,
  to: ProgramPoint,
  i: number,
  j: number,
  counterClockwise: boolean,
): Array<[ProgramPoint, ProgramPoint]> {
  const cx = from.x + i;
  const cy = from.y + j;
  const radius = Math.hypot(from.x - cx, from.y - cy);
  const start = Math.atan2(from.y - cy, from.x - cx);
  let sweep = Math.atan2(to.y - cy, to.x - cx) - start;
  if (counterClockwise) while (sweep <= 1e-9) sweep += 2 * Math.PI;
  else while (sweep >= -1e-9) sweep -= 2 * Math.PI;
  const step = 2 * Math.acos(Math.max(-1, 1 - ARC_SAGITTA_MM / Math.max(radius, 1e-6)));
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  const chords: Array<[ProgramPoint, ProgramPoint]> = [];
  let previous = from;
  for (let index = 1; index <= count; index += 1) {
    const angle = start + (sweep * index) / count;
    const point =
      index === count
        ? to
        : {
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle),
            z: from.z + ((to.z - from.z) * index) / count,
          };
    chords.push([previous, point]);
    previous = point;
  }
  return chords;
}

/** Stock over the walls' bounds and a millimetre around them, uncut. */
export function createHeightField(
  walls: ReadonlyArray<ReadonlyArray<Vec2>>,
  cellMm: number,
): HeightField {
  const xs = walls.flat().map((point) => point.x);
  const ys = walls.flat().map((point) => point.y);
  const minX = Math.min(...xs) - 1;
  const minY = Math.min(...ys) - 1;
  const width = Math.ceil((Math.max(...xs) + 1 - minX) / cellMm);
  const height = Math.ceil((Math.max(...ys) + 1 - minY) / cellMm);
  return { minX, minY, cellMm, width, height, z: new Float64Array(width * height) };
}

/**
 * Lower every cell centre a flat cutter of this radius passes over to the
 * lowest Z it reaches there, exactly: Z is linear along the move, so it is
 * lowest at one end of the stretch where the centre is within the radius.
 * Returns the area lowered by at least `minDropMm`.
 */
export function carveMove(
  field: HeightField,
  move: ProgramMove,
  radiusMm: number,
  minDropMm = 0.25,
): number {
  const { a, b } = move;
  if (Math.min(a.z, b.z) >= 0) return 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const col0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - radiusMm - field.minX) / field.cellMm));
  const col1 = Math.min(
    field.width - 1,
    Math.ceil((Math.max(a.x, b.x) + radiusMm - field.minX) / field.cellMm),
  );
  const row0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - radiusMm - field.minY) / field.cellMm));
  const row1 = Math.min(
    field.height - 1,
    Math.ceil((Math.max(a.y, b.y) + radiusMm - field.minY) / field.cellMm),
  );
  let lowered = 0;
  for (let row = row0; row <= row1; row += 1) {
    const py = field.minY + (row + 0.5) * field.cellMm;
    for (let col = col0; col <= col1; col += 1) {
      const px = field.minX + (col + 0.5) * field.cellMm;
      const fx = a.x - px;
      const fy = a.y - py;
      let reachedZ: number;
      if (lengthSquared < 1e-14) {
        if (fx * fx + fy * fy > radiusMm * radiusMm) continue;
        reachedZ = Math.min(a.z, b.z);
      } else {
        const half = fx * dx + fy * dy;
        const c = fx * fx + fy * fy - radiusMm * radiusMm;
        const discriminant = half * half - lengthSquared * c;
        if (discriminant < 0) continue;
        const root = Math.sqrt(discriminant);
        const t0 = Math.max(0, (-half - root) / lengthSquared);
        const t1 = Math.min(1, (-half + root) / lengthSquared);
        if (t0 > t1) continue;
        reachedZ = Math.min(a.z + (b.z - a.z) * t0, a.z + (b.z - a.z) * t1);
      }
      const index = row * field.width + col;
      const before = field.z[index] as number;
      if (reachedZ < before) {
        if (before - reachedZ >= minDropMm) lowered += field.cellMm * field.cellMm;
        field.z[index] = reachedZ;
      }
    }
  }
  return lowered;
}

/**
 * Stock left above the floor where a cutter centre could sit: inside the
 * walls (even-odd) and at least the cutter radius from every one of them.
 * Touching cells, edge or corner, form one patch.
 */
export function uncutReachableStock(
  field: HeightField,
  walls: ReadonlyArray<ReadonlyArray<Vec2>>,
  radiusMm: number,
  floorZMm: number,
  toleranceMm = 0.05,
): { readonly totalMm2: number; readonly patches: ReadonlyArray<StockPatch> } {
  const flagged = new Uint8Array(field.width * field.height);
  for (let index = 0; index < flagged.length; index += 1) {
    if ((field.z[index] as number) <= floorZMm + toleranceMm) continue;
    const point = cellCentre(field, index);
    if (insideWalls(point, walls) && wallDistance(point, walls) >= radiusMm) flagged[index] = 1;
  }
  const patches: StockPatch[] = [];
  const seen = new Uint8Array(flagged.length);
  for (let start = 0; start < flagged.length; start += 1)
    if (flagged[start] === 1 && seen[start] === 0)
      patches.push(floodPatch(field, flagged, seen, start));
  return { totalMm2: patches.reduce((sum, patch) => sum + patch.areaMm2, 0), patches };
}

function floodPatch(
  field: HeightField,
  flagged: Uint8Array,
  seen: Uint8Array,
  start: number,
): StockPatch {
  seen[start] = 1;
  const stack = [start];
  let cells = 0;
  let sumX = 0;
  let sumY = 0;
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const point = cellCentre(field, index);
    cells += 1;
    sumX += point.x;
    sumY += point.y;
    const row = Math.floor(index / field.width);
    const col = index - row * field.width;
    for (let r = Math.max(0, row - 1); r <= Math.min(field.height - 1, row + 1); r += 1)
      for (let c = Math.max(0, col - 1); c <= Math.min(field.width - 1, col + 1); c += 1) {
        const next = r * field.width + c;
        if (flagged[next] === 1 && seen[next] === 0) {
          seen[next] = 1;
          stack.push(next);
        }
      }
  }
  return {
    areaMm2: cells * field.cellMm * field.cellMm,
    centre: { x: sumX / cells, y: sumY / cells },
  };
}

function cellCentre(field: HeightField, index: number): Vec2 {
  const row = Math.floor(index / field.width);
  const col = index - row * field.width;
  return {
    x: field.minX + (col + 0.5) * field.cellMm,
    y: field.minY + (row + 0.5) * field.cellMm,
  };
}

function insideWalls(point: Vec2, walls: ReadonlyArray<ReadonlyArray<Vec2>>): boolean {
  let inside = false;
  for (const wall of walls)
    for (let i = 0, j = wall.length - 1; i < wall.length; j = i, i += 1) {
      const a = wall[i] as Vec2;
      const b = wall[j] as Vec2;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
  return inside;
}

function wallDistance(point: Vec2, walls: ReadonlyArray<ReadonlyArray<Vec2>>): number {
  let distance = Infinity;
  for (const wall of walls)
    for (let index = 0; index < wall.length; index += 1) {
      const a = wall[index] as Vec2;
      const b = wall[(index + 1) % wall.length] as Vec2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
      distance = Math.min(distance, Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y));
    }
  return distance;
}
