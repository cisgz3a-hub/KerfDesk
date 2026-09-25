// G1/G2/G3 burn lines for a laser segment carrying fitted arc moves (ADR-407).
//
// Power, feed and modal words follow the G1 path exactly: F and S ride the
// first emitted burn move (every move when the dialect asks), and a move that
// collapses onto the head at 3 decimals is skipped. An arc is written in the
// G17 offset form, I/J relative to the already-rounded start, since that is
// where the controller is. Before writing one, its words are replayed the way
// GRBL reads them (gcode.c radius check, mc_arc angular travel): the rounded
// centre must put the rounded end within ARC_EMIT_RADIUS_SLACK_MM of the start
// radius, far inside GRBL's own 0.005 mm limit, and GRBL's angular travel
// (atan2, then a full turn added when it reads the wrong way within
// ARC_ANGULAR_TRAVEL_EPSILON) must match the fitted sweep, so rounding can
// never turn a sliver into a near-full circle. An arc failing either check is
// written as G1 chords within the controller arc budget; for a sliver that is
// a single G1 to its end.

import type { GrblGcodeDialect } from '../devices';
import { formatGcodeCoordinateMm } from '../gcode';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { arcInteriorPoints, arcSweep, type ArcMove } from '../geometry/arc-fit';
import type { CutSegment } from '../job';
import { validCutArcMoves } from '../job/cut-arc-moves';
import type { Vec2 } from '../scene';

export type BurnWordContext = {
  readonly s: number;
  readonly feed: number;
  readonly dialect: GrblGcodeDialect;
};

type ArcMoveOf = Extract<ArcMove, { kind: 'arc' }>;

const ARC_EMIT_RADIUS_SLACK_MM = 0.002;
// How far the rounded arc may run from the fitted one along its circle.
const ARC_EMIT_TRAVEL_SLACK_MM = 0.004;
// ARC_ANGULAR_TRAVEL_EPSILON in grbl/config.h (gnea/grbl master).
const GRBL_ARC_ANGULAR_TRAVEL_EPSILON = 5e-7;
const ARC_CHORD_FALLBACK_SAGITTA_MM = 0.002;

/**
 * The burn lines for a segment's fitted arc moves, or null when this output
 * writes the polyline instead: arcs off for the machine, no valid moves, or a
 * tangential entry runway (ADR-239), whose ramp follows the first chord.
 */
export function arcBurnLines(
  segment: CutSegment,
  first: Vec2,
  context: BurnWordContext & {
    readonly arcMoves?: boolean | undefined;
    readonly entryRunwayMm?: number | undefined;
  },
): string[] | null {
  if (context.arcMoves !== true || context.entryRunwayMm !== undefined) return null;
  const moves = validCutArcMoves(segment);
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
      const words = arcOffsetWords({ x: Number(headX), y: Number(headY) }, from, move);
      if (words === null) {
        for (const point of arcInteriorPoints(from, move, ARC_CHORD_FALLBACK_SAGITTA_MM)) {
          moveTo('G1', point);
        }
        moveTo('G1', move.to);
      } else {
        moveTo(move.clockwise ? 'G2' : 'G3', move.to, words);
      }
    }
    from = move.to;
  }
  return lines;
}

// ' I.. J..' for an arc from the rounded head, or null when the rounded words
// would not reproduce it.
function arcOffsetWords(head: Vec2, from: Vec2, move: ArcMoveOf): string | null {
  const i = formatGcodeCoordinateMm(move.center.x - head.x);
  const j = formatGcodeCoordinateMm(move.center.y - head.y);
  const rx = -Number(i);
  const ry = -Number(j);
  const tx = Number(formatGcodeCoordinateMm(move.to.x)) - (head.x + Number(i));
  const ty = Number(formatGcodeCoordinateMm(move.to.y)) - (head.y + Number(j));
  const radius = Math.hypot(rx, ry);
  if (!(radius > 0) || Math.abs(Math.hypot(tx, ty) - radius) > ARC_EMIT_RADIUS_SLACK_MM) {
    return null;
  }
  // mc_arc: atan2 of the cross and dot of the start and end radius vectors,
  // pushed a full turn the commanded way when it reads the other way.
  let travel = Math.atan2(rx * ty - ry * tx, rx * tx + ry * ty);
  if (move.clockwise && travel >= -GRBL_ARC_ANGULAR_TRAVEL_EPSILON) travel -= 2 * Math.PI;
  if (!move.clockwise && travel <= GRBL_ARC_ANGULAR_TRAVEL_EPSILON) travel += 2 * Math.PI;
  const intended = arcSweep(from, move.to, move.center, move.clockwise);
  if (radius * Math.abs(Math.abs(travel) - intended) > ARC_EMIT_TRAVEL_SLACK_MM) return null;
  return ` I${i} J${j}`;
}
