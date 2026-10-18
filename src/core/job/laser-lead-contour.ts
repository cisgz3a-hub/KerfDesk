// Where on a closed contour its laser leads join it (ADR-626): the start,
// the directions the cut leaves and reaches it in, which way the contour turns,
// and, when no lead fits there, other places the contour could start instead.
//
// A hole that starts at a corner has no room for a lead that joins along its
// edge: inside the hole the scrap at a corner is a wedge the cut leaves and
// enters, and a lead coming in along the first edge would have to come from
// beyond the last one. Rectangles are drawn from a corner and Nearest corner
// starts at one, so the contour may start in the middle of a nearby edge
// instead, where the lead has the whole hole to sit in. The planner's travel
// barely changes: the new start is half an edge away.

import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { ArcMove } from '../geometry/arc-fit';
import type { Vec2 } from '../scene';
import {
  arcRotatableVertices,
  validCutArcMoves,
  withCutArcMoves,
  withoutArcMoves,
} from './cut-arc-moves';
import type { CutSegment } from './job';

export type ContourJoins = {
  readonly start: Vec2;
  /** The closing point, where the contour ends (bit for bit its start). */
  readonly end: Vec2;
  readonly startTangent: Vec2;
  readonly endTangent: Vec2;
  readonly counterClockwise: boolean;
};

// Directions are read over TANGENT_WINDOW_MM of path, so a contour that starts
// with a sliver of an edge still leads along the edge it really follows.
const TANGENT_WINDOW_MM = 0.05;
const MIN_EDGE_MM = 0.001;
const MIN_AREA_MM2 = 1e-9;
// Other starts tried, nearest first, on edges at least this long.
const MAX_RESTARTS = 4;
const MIN_RESTART_EDGE_MM = 1;
const MAX_RESTART_EDGES_SCANNED = 64;

/** Null for a contour too small or degenerate to give a lead a direction.
 * `moves` are the line/arc moves the contour goes out as, when it does (ADR-432):
 * then the directions are the moves' own, so an arc lead meets a G2/G3 move
 * tangentially instead of at the angle its first chord makes. */
export function contourJoins(
  ring: ReadonlyArray<Vec2>,
  moves: ReadonlyArray<ArcMove> | null = null,
): ContourJoins | null {
  const start = ring[0];
  const end = ring[ring.length - 1];
  if (start === undefined || end === undefined || ring.length < 4) return null;
  const area = signedAreaMm2(ring);
  if (!(Math.abs(area) > MIN_AREA_MM2)) return null;
  const startTangent =
    (moves === null ? null : leavingMoveTangent(start, moves)) ?? forwardTangent(ring);
  const endTangent =
    (moves === null ? null : arrivingMoveTangent(start, moves)) ?? backwardTangent(ring);
  if (startTangent === null || endTangent === null) return null;
  return { start, end, startTangent, endTangent, counterClockwise: area > 0 };
}

// The direction of travel where the first move leaves `start`.
function leavingMoveTangent(start: Vec2, moves: ReadonlyArray<ArcMove>): Vec2 | null {
  const move = moves[0];
  if (move === undefined) return null;
  return move.kind === 'line' ? unitBetween(start, move.to) : arcTangent(move, start);
}

// The direction of travel where the last move arrives at its end.
function arrivingMoveTangent(start: Vec2, moves: ReadonlyArray<ArcMove>): Vec2 | null {
  const move = moves[moves.length - 1];
  if (move === undefined) return null;
  if (move.kind === 'arc') return arcTangent(move, move.to);
  const from = moves.length > 1 ? (moves[moves.length - 2] as ArcMove).to : start;
  return unitBetween(from, move.to);
}

// Along the circle at `point`: the radius turned a quarter turn the way the
// arc runs.
function arcTangent(move: Extract<ArcMove, { kind: 'arc' }>, point: Vec2): Vec2 | null {
  const rx = point.x - move.center.x;
  const ry = point.y - move.center.y;
  const radius = Math.hypot(rx, ry);
  if (!(radius > 0)) return null;
  return move.clockwise ? { x: ry / radius, y: -rx / radius } : { x: -ry / radius, y: rx / radius };
}

/** The direction the path arrives at its last point in. */
export function backwardTangent(points: ReadonlyArray<Vec2>): Vec2 | null {
  const to = points[points.length - 1] as Vec2;
  let fallback: Vec2 | null = null;
  for (let index = points.length - 2; index >= Math.floor(points.length / 2) - 1; index -= 1) {
    const from = points[index];
    if (from === undefined) break;
    const direction = unitBetween(from, to);
    if (direction === null) continue;
    if (Math.hypot(to.x - from.x, to.y - from.y) >= TANGENT_WINDOW_MM) return direction;
    fallback ??= direction;
  }
  return fallback;
}

function forwardTangent(points: ReadonlyArray<Vec2>): Vec2 | null {
  const from = points[0] as Vec2;
  let fallback: Vec2 | null = null;
  for (let index = 1; index < Math.ceil(points.length / 2) + 1; index += 1) {
    const to = points[index] as Vec2;
    const direction = unitBetween(from, to);
    if (direction === null) continue;
    if (Math.hypot(to.x - from.x, to.y - from.y) >= TANGENT_WINDOW_MM) return direction;
    fallback ??= direction;
  }
  return fallback;
}

function unitBetween(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length >= MIN_EDGE_MM ? { x: dx / length, y: dy / length } : null;
}

/** The interior lies left of travel on a counter-clockwise contour (Y up) and
 * right of it on a clockwise one; the scrap is the interior for a lead inside. */
export function scrapNormal(tangent: Vec2, counterClockwise: boolean, inside: boolean): Vec2 {
  const interior = counterClockwise
    ? { x: -tangent.y, y: tangent.x }
    : { x: tangent.y, y: -tangent.x };
  return inside ? interior : { x: -interior.x, y: -interior.y };
}

/**
 * The same closed contour started in the middle of each of the nearest edges
 * at least MIN_RESTART_EDGE_MM long, alternating forward and back from its
 * start, at most MAX_RESTARTS. A contour that goes out as arcs (ADR-432) only
 * restarts on an edge that is a single line move, which splits there.
 */
export function restartedContours(segment: CutSegment): CutSegment[] {
  const ring = segment.polyline;
  const vertexCount = ring.length - 1;
  const restarts: CutSegment[] = [];
  const scanned = Math.min(vertexCount, MAX_RESTART_EDGES_SCANNED);
  for (let step = 0; step < scanned && restarts.length < MAX_RESTARTS; step += 1) {
    const edge = step % 2 === 0 ? step / 2 : vertexCount - (step + 1) / 2;
    const restarted = restartedAtEdge(segment, edge);
    if (restarted !== null) restarts.push(restarted);
  }
  return restarts;
}

function restartedAtEdge(segment: CutSegment, edge: number): CutSegment | null {
  const ring = segment.polyline;
  const vertexCount = ring.length - 1;
  const a = ring[edge] as Vec2;
  const b = ring[edge + 1] as Vec2;
  if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_RESTART_EDGE_MM) return null;
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const polyline = [
    middle,
    ...ring.slice(edge + 1, vertexCount),
    ...ring.slice(0, edge + 1),
    middle,
  ];
  const restarted: CutSegment = { ...withoutArcMoves(segment), polyline };
  const moves = validCutArcMoves(segment);
  if (moves === null) return restarted;
  const first = edge === 0 ? 0 : (arcRotatableVertices(segment)?.get(edge) ?? -2) + 1;
  const move = moves[first];
  if (move?.kind !== 'line' || move.to.x !== b.x || move.to.y !== b.y) return null;
  const withArcs = withCutArcMoves(restarted, [
    move,
    ...moves.slice(first + 1),
    ...moves.slice(0, first),
    { kind: 'line', to: middle },
  ]);
  return withArcs.arcMoves === undefined ? null : withArcs;
}
