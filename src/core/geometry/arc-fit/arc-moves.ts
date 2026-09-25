// Line/arc move sequences as consumers read them (ADR-407): the checks a
// stored sequence must pass before anything trusts it, exact bounds including
// arc extrema, dense sampling for previews, reversal and translation.

import type { Vec2 } from '../../scene';
import {
  ARC_FIT_MAX_RADIUS_MM,
  ARC_FIT_MAX_SWEEP_RAD,
  ARC_FIT_MIN_RADIUS_MM,
} from './arc-fit-limits';
import { arcSweep } from './arc-primitives';

export type ArcMove =
  | { readonly kind: 'line'; readonly to: Vec2 }
  | {
      readonly kind: 'arc';
      readonly to: Vec2;
      readonly center: Vec2;
      readonly clockwise: boolean;
    };

export type ArcMoveBounds = { minX: number; minY: number; maxX: number; maxY: number };

// Stored arcs come from the fitter, whose start and end radii agree to float
// noise; anything looser is not an arc this module produced.
const RADIUS_MATCH_RELATIVE = 1e-6;
const RADIUS_MATCH_ABSOLUTE_MM = 1e-6;
const SWEEP_SLACK_RAD = 1e-6;

/**
 * Whether `moves` is a sequence this module can emit from `start` to exactly
 * `end`: finite numbers, arcs whose start and end lie on one circle within
 * the fitting limits, and the final move landing on `end` bit for bit.
 */
export function arcMovesConnect(start: Vec2, moves: ReadonlyArray<ArcMove>, end: Vec2): boolean {
  const last = moves[moves.length - 1];
  if (last === undefined || last.to.x !== end.x || last.to.y !== end.y) return false;
  let from = start;
  for (const move of moves) {
    if (!finite(move.to)) return false;
    if (move.kind === 'arc' && !arcIsSound(from, move)) return false;
    from = move.to;
  }
  return true;
}

function arcIsSound(from: Vec2, move: Extract<ArcMove, { kind: 'arc' }>): boolean {
  if (!finite(move.center)) return false;
  const radius = Math.hypot(from.x - move.center.x, from.y - move.center.y);
  const endRadius = Math.hypot(move.to.x - move.center.x, move.to.y - move.center.y);
  if (radius < ARC_FIT_MIN_RADIUS_MM * 0.5 || radius > ARC_FIT_MAX_RADIUS_MM * 2) return false;
  if (Math.abs(radius - endRadius) > RADIUS_MATCH_ABSOLUTE_MM + radius * RADIUS_MATCH_RELATIVE) {
    return false;
  }
  return (
    arcSweep(from, move.to, move.center, move.clockwise) <= ARC_FIT_MAX_SWEEP_RAD + SWEEP_SLACK_RAD
  );
}

/** Extends `bounds` by the exact extent of the moves, arc extrema included. */
export function extendBoundsByArcMoves(
  bounds: ArcMoveBounds,
  start: Vec2,
  moves: ReadonlyArray<ArcMove>,
): void {
  extendPoint(bounds, start);
  let from = start;
  for (const move of moves) {
    extendPoint(bounds, move.to);
    if (move.kind === 'arc') extendByArcExtrema(bounds, from, move);
    from = move.to;
  }
}

// An arc reaches an axis extreme where its direction angle crosses a multiple
// of a quarter turn inside its sweep.
function extendByArcExtrema(
  bounds: ArcMoveBounds,
  from: Vec2,
  move: Extract<ArcMove, { kind: 'arc' }>,
): void {
  const radius = Math.hypot(from.x - move.center.x, from.y - move.center.y);
  const startAngle = Math.atan2(from.y - move.center.y, from.x - move.center.x);
  const sweep = arcSweep(from, move.to, move.center, move.clockwise);
  const direction = move.clockwise ? -1 : 1;
  for (let quarter = 0; quarter < 4; quarter += 1) {
    const angle = (quarter * Math.PI) / 2;
    let offset = direction * (angle - startAngle);
    offset -= Math.floor(offset / (2 * Math.PI)) * 2 * Math.PI;
    if (offset > 0 && offset < sweep) {
      extendPoint(bounds, {
        x: move.center.x + radius * Math.cos(angle),
        y: move.center.y + radius * Math.sin(angle),
      });
    }
  }
}

/**
 * The moves as a polyline: each line's end, and points along each arc no
 * farther than `maxSagittaMm` from it. Every move end is kept exactly.
 */
export function sampleArcMoves(
  start: Vec2,
  moves: ReadonlyArray<ArcMove>,
  maxSagittaMm: number,
): Vec2[] {
  const points: Vec2[] = [start];
  let from = start;
  for (const move of moves) {
    if (move.kind === 'arc') points.push(...arcInteriorPoints(from, move, maxSagittaMm));
    points.push(move.to);
    from = move.to;
  }
  return points;
}

export function arcInteriorPoints(
  from: Vec2,
  move: Extract<ArcMove, { kind: 'arc' }>,
  maxSagittaMm: number,
): Vec2[] {
  const radius = Math.hypot(from.x - move.center.x, from.y - move.center.y);
  const sweep = arcSweep(from, move.to, move.center, move.clockwise);
  const ratio = Math.max(-1, Math.min(1, 1 - maxSagittaMm / radius));
  const step = Math.max(1e-3, 2 * Math.acos(ratio));
  const count = Math.max(1, Math.ceil(sweep / step));
  const startAngle = Math.atan2(from.y - move.center.y, from.x - move.center.x);
  const direction = move.clockwise ? -1 : 1;
  const points: Vec2[] = [];
  for (let index = 1; index < count; index += 1) {
    const angle = startAngle + (direction * sweep * index) / count;
    points.push({
      x: move.center.x + radius * Math.cos(angle),
      y: move.center.y + radius * Math.sin(angle),
    });
  }
  return points;
}

/** The same path run backwards from `end` (the last move's target). */
export function reverseArcMoves(start: Vec2, moves: ReadonlyArray<ArcMove>): ArcMove[] {
  const reversed: ArcMove[] = [];
  for (let index = moves.length - 1; index >= 0; index -= 1) {
    const move = moves[index] as ArcMove;
    const to = index === 0 ? start : (moves[index - 1] as ArcMove).to;
    reversed.push(
      move.kind === 'line'
        ? { kind: 'line', to }
        : { kind: 'arc', to, center: move.center, clockwise: !move.clockwise },
    );
  }
  return reversed;
}

export function translateArcMoves(
  moves: ReadonlyArray<ArcMove>,
  dx: number,
  dy: number,
): ArcMove[] {
  const shift = (point: Vec2): Vec2 => ({ x: point.x + dx, y: point.y + dy });
  return moves.map(
    (move): ArcMove =>
      move.kind === 'line'
        ? { kind: 'line', to: shift(move.to) }
        : {
            kind: 'arc',
            to: shift(move.to),
            center: shift(move.center),
            clockwise: move.clockwise,
          },
  );
}

function extendPoint(bounds: ArcMoveBounds, point: Vec2): void {
  if (point.x < bounds.minX) bounds.minX = point.x;
  if (point.x > bounds.maxX) bounds.maxX = point.x;
  if (point.y < bounds.minY) bounds.minY = point.y;
  if (point.y > bounds.maxY) bounds.maxY = point.y;
}

function finite(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
