// Lighter drawings of a big program for zoomed-out views (ADR-485). When a
// program has hundreds of thousands of moves, many fall inside one pixel of
// the whole-job view, yet each costs the GPU a fat line. The parse worker
// works out, for two tolerances, which runs of moves one straight line can
// stand for: consecutive solid moves that join end to end, would be coloured
// the same by every lens but depth, and never stray from the line by more
// than the tolerance. The view draws the coarsest level whose tolerance is
// under half a pixel, and every move once zoomed in past both.
//
// Pure typed-array code with no three.js, so the worker can run it.

import { SEG_KIND } from '../../core/gcode-view';

const FLOATS_PER_SEGMENT = 6;
/** Programs with fewer solid moves draw every move at every zoom. */
export const DETAIL_MIN_MOVES = 100_000;
/** The most moves one drawn line stands for. */
const MAX_RUN = 64;
/** Each level's tolerance as a share of the job's diagonal, coarsest first. */
const LEVEL_SHARES = [1 / 2000, 1 / 8000] as const;
// A level that saves less than this share of the moves is not worth drawing.
const MIN_SAVING = 0.25;
const SAME_COUNT = 0.9;

/** One simplified drawing: line k stands for moves starts[k] to ends[k]. */
export type MoveDetailLevel = {
  /** How far any move may be from the line drawn for it, in mm. */
  readonly toleranceMm: number;
  readonly starts: Uint32Array;
  readonly ends: Uint32Array;
};

/** The levels a big program can be drawn at, coarsest first. */
export type MoveDetail = {
  /** Solid moves in the program: what every level stands for. */
  readonly solidMoves: number;
  readonly levels: ReadonlyArray<MoveDetailLevel>;
};

export type MoveDetailInput = {
  readonly segmentCount: number;
  readonly positions: Float32Array;
  readonly segKind: Uint8Array;
  readonly segFeed: Float32Array;
  readonly segPower: Float32Array;
  readonly segLine: Uint32Array;
  /** Per move, 1 where the planner never reached the programmed feed. */
  readonly feedLimited?: Uint8Array | undefined;
  /** Source lines where the program changes tool, ascending. */
  readonly toolLines?: ReadonlyArray<number> | undefined;
  /** The job's diagonal, which the tolerances scale with. */
  readonly diagonalMm: number;
};

export function buildMoveDetail(input: MoveDetailInput): MoveDetail | null {
  const solidMoves = countSolid(input);
  if (solidMoves < DETAIL_MIN_MOVES || !(input.diagonalMm > 0)) return null;
  const joins = joinsNext(input);
  const levels: MoveDetailLevel[] = [];
  for (const share of LEVEL_SHARES) {
    const level = buildLevel(input, joins, solidMoves, input.diagonalMm * share);
    if (level.starts.length > solidMoves * (1 - MIN_SAVING)) continue;
    // A coarser level that draws about as many lines as this one is no
    // lighter, only less exact.
    const coarser = levels.at(-1);
    if (coarser !== undefined && coarser.starts.length >= level.starts.length * SAME_COUNT) {
      levels.pop();
    }
    levels.push(level);
  }
  return levels.length === 0 ? null : { solidMoves, levels };
}

function countSolid(input: MoveDetailInput): number {
  let count = 0;
  for (let index = 0; index < input.segmentCount; index += 1) {
    if (input.segKind[index] !== SEG_KIND.travel) count += 1;
  }
  return count;
}

// 1 where move i+1 carries on from move i: both solid, the same kind, feed,
// power and reached feed, no tool change between them, and joined end to end.
function joinsNext(input: MoveDetailInput): Uint8Array {
  const joins = new Uint8Array(input.segmentCount);
  const toolChange = toolChangeFinder(input.segLine, input.toolLines ?? []);
  for (let index = 0; index + 1 < input.segmentCount; index += 1) {
    const next = index + 1;
    if (toolChange(index)) continue;
    if (sameLook(input, index, next) && touches(input.positions, index, next)) joins[index] = 1;
  }
  return joins;
}

// Whether a tool change falls between move i and the next; asked in order.
function toolChangeFinder(
  segLine: Uint32Array,
  tools: ReadonlyArray<number>,
): (index: number) => boolean {
  let nextTool = 0;
  return (index) => {
    const line = segLine[index] ?? 0;
    while (nextTool < tools.length && (tools[nextTool] ?? 0) <= line) nextTool += 1;
    return nextTool < tools.length && (tools[nextTool] ?? 0) <= (segLine[index + 1] ?? 0);
  };
}

// Two solid moves every lens but depth colours alike.
function sameLook(input: MoveDetailInput, index: number, next: number): boolean {
  const { segKind, segFeed, segPower, feedLimited } = input;
  return (
    segKind[index] !== SEG_KIND.travel &&
    segKind[next] === segKind[index] &&
    segFeed[next] === segFeed[index] &&
    segPower[next] === segPower[index] &&
    (feedLimited === undefined || feedLimited[next] === feedLimited[index])
  );
}

function touches(positions: Float32Array, index: number, next: number): boolean {
  const end = index * FLOATS_PER_SEGMENT + 3;
  const start = next * FLOATS_PER_SEGMENT;
  return (
    positions[end] === positions[start] &&
    positions[end + 1] === positions[start + 1] &&
    positions[end + 2] === positions[start + 2]
  );
}

function buildLevel(
  input: MoveDetailInput,
  joins: Uint8Array,
  solidMoves: number,
  toleranceMm: number,
): MoveDetailLevel {
  const starts = new Uint32Array(solidMoves);
  const ends = new Uint32Array(solidMoves);
  const toleranceSq = toleranceMm * toleranceMm;
  let lines = 0;
  let index = 0;
  while (index < input.segmentCount) {
    if (input.segKind[index] === SEG_KIND.travel) {
      index += 1;
      continue;
    }
    const last = longestRun(input.positions, joins, index, toleranceSq);
    starts[lines] = index;
    ends[lines] = last;
    lines += 1;
    index = last + 1;
  }
  return { toleranceMm, starts: starts.slice(0, lines), ends: ends.slice(0, lines) };
}

// The last move of the longest run from `first` that stays near its line.
// Longer runs are tried at doubling lengths, then the gap is halved, so a run
// of n moves costs about n log n distance checks rather than n squared. Every
// run returned has passed the full check.
function longestRun(
  positions: Float32Array,
  joins: Uint8Array,
  first: number,
  toleranceSq: number,
): number {
  let joined = first;
  while (joined - first + 1 < MAX_RUN && joins[joined] === 1) joined += 1;
  let good = first;
  let bad = joined + 1;
  for (let length = 2; first + length - 1 <= joined; length *= 2) {
    if (!staysNear(positions, first, first + length - 1, toleranceSq)) {
      bad = first + length - 1;
      break;
    }
    good = first + length - 1;
  }
  if (bad === joined + 1 && good < joined) {
    if (staysNear(positions, first, joined, toleranceSq)) return joined;
    bad = joined;
  }
  while (bad - good > 1) {
    const middle = (good + bad) >> 1;
    if (staysNear(positions, first, middle, toleranceSq)) good = middle;
    else bad = middle;
  }
  return good;
}

// Whether every join between moves first and last lies within the tolerance
// of the line from first's start to last's end.
function staysNear(
  positions: Float32Array,
  first: number,
  last: number,
  toleranceSq: number,
): boolean {
  const from = first * FLOATS_PER_SEGMENT;
  const to = last * FLOATS_PER_SEGMENT + 3;
  const ax = coordinate(positions, from);
  const ay = coordinate(positions, from + 1);
  const az = coordinate(positions, from + 2);
  const dx = coordinate(positions, to) - ax;
  const dy = coordinate(positions, to + 1) - ay;
  const dz = coordinate(positions, to + 2) - az;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  for (let move = first; move < last; move += 1) {
    const at = move * FLOATS_PER_SEGMENT + 3;
    const px = coordinate(positions, at) - ax;
    const py = coordinate(positions, at + 1) - ay;
    const pz = coordinate(positions, at + 2) - az;
    const along = lengthSq > 0 ? clamp01((px * dx + py * dy + pz * dz) / lengthSq) : 0;
    const ex = px - dx * along;
    const ey = py - dy * along;
    const ez = pz - dz * along;
    if (ex * ex + ey * ey + ez * ez > toleranceSq) return false;
  }
  return true;
}

function coordinate(positions: Float32Array, at: number): number {
  return positions[at] ?? 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
