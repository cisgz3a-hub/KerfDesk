// The order a Ruida rotary layer's speed-class pieces burn in (ADR-127
// Amendments 7 and 8). Amendment 7 burned them nearest first: half the
// laser-off travel, but the rotary turned back more often, and for small
// shapes such as text more pieces started against the way it last turned, so
// the chuck's backlash was taken up inside the burn (code quality audit C2
// verify E3-P2-2). Amendment 8 sweeps:
//  - The rotary keeps turning one way while any piece is left ahead of the
//    head that can burn that way; of those it takes the nearest, counting how
//    far ahead it starts as travel too.
//  - When none is left, it turns once and sweeps back the same way.
//  - A piece that would start against the way the rotary last turned is
//    reached past its start and back, so the rotary turns with the laser off
//    and every burn starts the way it goes on.
// Pieces burn from either end; a vector stroke marks the same either way.

import type { RdMotionStep } from './rd-motion-plan';

/** A run of consecutive cuts in one speed class, in path order. */
export type Piece = { readonly start: RdMotionStep; readonly cuts: ReadonlyArray<RdMotionStep> };

/** Where the head is and which way the rotary last turned (1, -1, or 0: not yet). */
export type Head = { readonly at: RdMotionStep | null; readonly dir: number };

type YRange = { readonly minY: number; readonly maxY: number };

/** How far past a piece's start the approach runs, in µm of machine Y: more
 *  than a rotary's backlash. Kept inside the part's own Y range. */
export const APPROACH_UM = 1000;
/** A turn back of the rotary weighs as much as this much laser-off travel. */
const REVERSAL_COST_UM = 5000;
/** A burn that starts against the rotary weighs this much more again. */
const AGAINST_COST_UM = 50000;

/** One way to burn a piece: from its start, or reversed from its end. */
type End = { readonly start: RdMotionStep; readonly way: number; readonly reversed: boolean };
/** A piece with both its ends worked out once, so a choice reads them
 *  without copying the piece. */
type Prepared = { readonly piece: Piece; readonly ends: readonly [End, End] };
type Entry = {
  readonly moves: ReadonlyArray<RdMotionStep>;
  readonly end: End;
  readonly cost: number;
};
type Choice = { readonly index: number; readonly entry: Entry };

/** The pieces in burn order from `head`, each reached by laser-off moves. */
export function orderedPieceSteps(
  pieces: ReadonlyArray<Piece>,
  head: Head,
  yRange: YRange,
): { readonly steps: RdMotionStep[]; readonly head: Head } {
  const left = pieces.map(prepare);
  const steps: RdMotionStep[] = [];
  let current = head;
  while (left.length > 0) {
    const { index, entry } = bestEntry(left, current, yRange);
    const [chosen] = left.splice(index, 1);
    if (chosen === undefined) break;
    const piece = entry.end.reversed ? reversedPiece(chosen.piece) : chosen.piece;
    steps.push(...entry.moves, ...piece.cuts);
    const end = piece.cuts[piece.cuts.length - 1] ?? piece.start;
    current = { at: end, dir: turned(current, [...entry.moves, ...piece.cuts]).dir };
  }
  return { steps, head: current };
}

/** Which of `groups` (a layer's speed classes) to burn next from `head`: the
 *  one holding the piece the sweep would take from all of them, so a class
 *  change goes on the way the rotary turns when another class can. */
export function nextGroup(
  groups: ReadonlyArray<ReadonlyArray<Piece>>,
  head: Head,
  yRange: YRange,
): number {
  const owners: number[] = [];
  const pieces: Prepared[] = [];
  groups.forEach((group, index) => {
    for (const piece of group) {
      owners.push(index);
      pieces.push(prepare(piece));
    }
  });
  if (pieces.length === 0) return 0;
  return owners[bestEntry(pieces, head, yRange).index] ?? 0;
}

function bestEntry(pieces: ReadonlyArray<Prepared>, head: Head, yRange: YRange): Choice {
  return (
    sweepEntry(pieces, head) ??
    turnEntry(pieces, head, yRange) ??
    cheapestEntry(pieces, head, yRange)
  );
}

/** The next piece without turning the rotary back: of those starting ahead of
 *  the head the way it turns and burning that way, the one nearest, how far
 *  ahead it starts counted again. Null when none is left that way. */
function sweepEntry(pieces: ReadonlyArray<Prepared>, head: Head): Choice | null {
  const at = head.at;
  if (at === null || head.dir === 0) return null;
  let best: (Choice & { readonly score: number }) | null = null;
  pieces.forEach(({ ends }, index) => {
    for (const end of ends) {
      const ahead = (end.start.yUm - at.yUm) * head.dir;
      if (ahead < 0 || (end.way !== 0 && end.way !== head.dir)) continue;
      const start = offAt(end.start);
      const cost = Math.hypot(start.xUm - at.xUm, start.yUm - at.yUm);
      // How far ahead counts as travel again: a piece passed over now is a
      // pass back later.
      const score = cost + ahead;
      if (best === null || score < best.score) {
        const moves = samePoint(at, start) ? [] : [start];
        best = { index, entry: { moves, end, cost }, score };
      }
    }
  });
  return best;
}

/** When nothing is left ahead, the rotary turns once and sweeps back: the
 *  piece the sweep the other way would take, reached so that the rotary turns
 *  with the laser off. */
function turnEntry(pieces: ReadonlyArray<Prepared>, head: Head, yRange: YRange): Choice | null {
  const back = sweepEntry(pieces, { ...head, dir: -head.dir });
  return back === null
    ? null
    : { index: back.index, entry: entryInto(back.entry.end, head, yRange) };
}

/** The first piece of a job, and any piece the sweeps cannot take: the
 *  cheapest in travel, turns and burns started against the rotary. */
function cheapestEntry(pieces: ReadonlyArray<Prepared>, head: Head, yRange: YRange): Choice {
  let best: Choice | null = null;
  pieces.forEach(({ ends }, index) => {
    for (const end of ends) {
      const entry = entryInto(end, head, yRange);
      if (best === null || entry.cost < best.entry.cost) best = { index, entry };
    }
  });
  if (best === null) throw new Error('orderedPieceSteps: no piece left');
  return best;
}

/** The cheaper of reaching the piece's start straight, or by running past it
 *  and coming back so the burn starts the way the rotary turns. */
function entryInto(end: End, head: Head, yRange: YRange): Entry {
  const start = offAt(end.start);
  if (head.at === null) return { moves: [start], end, cost: 0 };
  const direct = costed(end, head, samePoint(head.at, start) ? [] : [start]);
  const way = end.way;
  const approachY = clamp(start.yUm - way * APPROACH_UM, yRange.minY, yRange.maxY);
  if (way === 0 || approachY === start.yUm) return direct;
  const approach = costed(end, head, [{ xUm: start.xUm, yUm: approachY, cut: false }, start]);
  return approach.cost < direct.cost ? approach : direct;
}

function costed(end: End, head: Head, moves: ReadonlyArray<RdMotionStep>): Entry {
  const travel = turned(head, moves);
  const way = end.way;
  const against = way !== 0 && travel.dir !== 0 && way !== travel.dir ? 1 : 0;
  let distance = 0;
  let at = head.at;
  for (const move of moves) {
    if (at !== null) distance += Math.hypot(move.xUm - at.xUm, move.yUm - at.yUm);
    at = move;
  }
  const cost =
    distance + REVERSAL_COST_UM * (travel.reversals + against) + AGAINST_COST_UM * against;
  return { moves, end, cost };
}

/** The rotary's way after `moves` from `head`, and how often it turned back. */
function turned(
  head: Head,
  moves: ReadonlyArray<RdMotionStep>,
): { readonly dir: number; readonly reversals: number } {
  let dir = head.dir;
  let reversals = 0;
  let y = head.at?.yUm;
  for (const move of moves) {
    const way = y === undefined ? 0 : Math.sign(move.yUm - y);
    if (way !== 0) {
      if (dir !== 0 && way !== dir) reversals += 1;
      dir = way;
    }
    y = move.yUm;
  }
  return { dir, reversals };
}

function prepare(piece: Piece): Prepared {
  const points = [piece.start, ...piece.cuts];
  return {
    piece,
    ends: [
      { start: piece.start, way: firstTurn(points), reversed: false },
      {
        start: points[points.length - 1] ?? piece.start,
        way: firstTurn([...points].reverse()),
        reversed: true,
      },
    ],
  };
}

/** The way the first move along Y between `points` turns the rotary (0: none does). */
function firstTurn(points: ReadonlyArray<RdMotionStep>): number {
  for (let i = 1; i < points.length; i += 1) {
    const way = Math.sign((points[i]?.yUm ?? 0) - (points[i - 1]?.yUm ?? 0));
    if (way !== 0) return way;
  }
  return 0;
}

function reversedPiece(piece: Piece): Piece {
  const points = [piece.start, ...piece.cuts].reverse();
  const [start, ...rest] = points;
  return { start: start ?? piece.start, cuts: rest.map((point) => ({ ...point, cut: true })) };
}

function offAt(point: RdMotionStep): RdMotionStep {
  return { xUm: point.xUm, yUm: point.yUm, cut: false };
}

function samePoint(a: RdMotionStep, b: RdMotionStep): boolean {
  return a.xUm === b.xUm && a.yUm === b.yUm;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
