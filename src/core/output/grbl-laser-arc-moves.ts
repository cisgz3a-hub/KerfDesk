// G1/G2/G3 burn lines for a laser segment carrying fitted arc moves (ADR-407).
//
// Power, feed and modal words follow the G1 path exactly: F and S ride the
// first emitted burn move (every move when the dialect asks), and a move that
// collapses onto the head at 3 decimals is skipped. An arc is written in the
// G17 offset form (the preamble selects G17 whenever the job writes arcs), I/J
// relative to the already-rounded start, since that is where the controller
// is. Before writing one, its words are replayed the way GRBL reads them
// (emittedArc in core/job/cut-arc-moves.ts, shared with bounds); an arc whose
// words would not reproduce it is written as G1 chords within the controller
// arc budget; for a sliver that is a single G1 to its end.

import type { GrblGcodeDialect } from '../devices';
import { formatGcodeCoordinateMm } from '../gcode';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { arcInteriorPoints, type ArcMove } from '../geometry/arc-fit';
import type { CutSegment } from '../job';
import { emittedArc, emittedCutArcMoves, type CutArcEmission } from '../job/cut-arc-moves';
import type { Vec2 } from '../scene';

export type BurnWordContext = {
  readonly s: number;
  readonly feed: number;
  readonly dialect: GrblGcodeDialect;
};

const ARC_CHORD_FALLBACK_SAGITTA_MM = 0.002;

/**
 * The burn lines for a segment's fitted arc moves, or null when this output
 * writes the polyline instead (see emittedCutArcMoves).
 */
export function arcBurnLines(
  segment: CutSegment,
  first: Vec2,
  context: BurnWordContext & CutArcEmission,
): string[] | null {
  const moves = emittedCutArcMoves(segment, context);
  return moves === null ? null : arcMoveBurnLines(first, moves, context);
}

export function arcMoveBurnLines(
  start: Vec2,
  moves: ReadonlyArray<ArcMove>,
  context: BurnWordContext,
): string[] {
  const lines: string[] = [];
  let headX = formatGcodeCoordinateMm(start.x);
  let headY = formatGcodeCoordinateMm(start.y);
  const moveTo = (motion: string, point: Vec2, offsetWords = ''): void => {
    const x = formatGcodeCoordinateMm(point.x);
    const y = formatGcodeCoordinateMm(point.y);
    if (x === headX && y === headY) return;
    const first = lines.length === 0;
    const feedWord =
      first || !context.dialect.modalFeedrate ? ` F${formatGcodeFeedMmPerMin(context.feed)}` : '';
    const sWord = first || context.dialect.emitSOnEveryBurnMove ? ` S${context.s}` : '';
    lines.push(`${motion} X${x} Y${y}${offsetWords}${feedWord}${sWord}`);
    headX = x;
    headY = y;
  };
  let from = start;
  for (const move of moves) {
    if (move.kind === 'line') {
      moveTo('G1', move.to);
    } else {
      // The head is always the rounding of `from`: every emitted or skipped
      // move leaves it at the rounded end of the move before.
      const arc = emittedArc(from, move);
      if (arc === null) {
        for (const point of arcInteriorPoints(from, move, ARC_CHORD_FALLBACK_SAGITTA_MM)) {
          moveTo('G1', point);
        }
        moveTo('G1', move.to);
      } else {
        moveTo(move.clockwise ? 'G2' : 'G3', move.to, ` I${arc.i} J${arc.j}`);
      }
    }
    from = move.to;
  }
  return lines;
}
