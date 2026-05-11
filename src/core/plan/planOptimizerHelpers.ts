/**
 * T1-149: pure helpers extracted from `PlanOptimizer`. Pre-T1-149
 * these eight functions lived inside the 1056-line PlanOptimizer.ts
 * mixed with the major planner stages (planOperation / planPath /
 * planFillOperation / planRasterOperation / orderPathsForCutting).
 *
 * All eight are pure — no `this`, no module-scope state — but using
 * them required loading every PlanOptimizer import (FillGenerator,
 * RasterGenerator, ContainmentTree, OperationOrderer, etc.). Hoisting
 * them to a sibling module:
 *
 *   - Coordinate accessors:
 *       getPathStart / getPathEnd / getPathEndpoint(reversed)
 *   - Direction-choice helper for nearest-neighbor ordering:
 *       orderWithBestDirection
 *   - Position tracking after a planned operation:
 *       getFinalPosition / getFinalPositionFromMoves
 *   - Plan AABB:
 *       computePlanBounds
 *   - Squared euclidean distance:
 *       distanceSq
 *
 * No behavior change — every consumer in PlanOptimizer imports back
 * the same functions.
 */
import { type Point, type AABB, emptyAABB, mergeAABB } from '../types';
import type { FlatPath } from '../job/Job';
import type { Move, Plan } from './Plan';

/** Squared euclidean distance — cheap proxy for sort comparisons. */
export function distanceSq(a: Point, b: Point): number {
  return (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
}

/** First point of a `FlatPath` (the coords array's first {x,y} pair). */
export function getPathStart(path: FlatPath): Point {
  return { x: path.coords[0], y: path.coords[1] };
}

/** Last point of a `FlatPath` (the coords array's last {x,y} pair). */
export function getPathEnd(path: FlatPath): Point {
  const n = path.coords.length;
  return { x: path.coords[n - 2], y: path.coords[n - 1] };
}

/**
 * The point the laser head ends up at after traversing `path`. For
 * closed paths the head returns to the start regardless of direction;
 * for open paths it ends at the opposite endpoint of where it started.
 */
export function getPathEndpoint(path: FlatPath, reversed: boolean): Point {
  if (path.closed) {
    // Closed paths return to start, regardless of direction
    return reversed ? getPathEnd(path) : getPathStart(path);
  }
  return reversed ? getPathStart(path) : getPathEnd(path);
}

/** OrderedPath shape: a path plus whether to traverse it reversed. */
export interface OrderedPath {
  path: FlatPath;
  reversed: boolean;
}

/**
 * Walk `paths` in fixed order, choosing per-path traversal direction
 * (start→end vs end→start) to minimize travel from the current
 * position. Returns the ordered list plus per-path reversed flags.
 */
export function orderWithBestDirection(paths: FlatPath[], startPos: Point): OrderedPath[] {
  if (paths.length === 0) return [];
  const result: OrderedPath[] = [];
  let pos = startPos;
  for (const path of paths) {
    const start = getPathStart(path);
    const end = getPathEnd(path);
    const dStart = distanceSq(pos, start);
    const dEnd = distanceSq(pos, end);
    const reversed = dEnd < dStart;
    result.push({ path, reversed });
    pos = getPathEndpoint(path, reversed);
  }
  return result;
}

/**
 * Endpoint of the last ordered path (where the head will be after
 * traversing the ordered list). Returns `fallback` for an empty list.
 */
export function getLastOrderedPathEndpoint(ordered: OrderedPath[], fallback: Point): Point {
  if (ordered.length === 0) return fallback;
  const last = ordered[ordered.length - 1];
  return getPathEndpoint(last.path, last.reversed);
}

/**
 * Final head position after a list of planned operations. Returns
 * (0, 0) if no operations or no positional moves were emitted.
 */
export function getFinalPosition(ops: ReadonlyArray<{ moves: Move[] }>): Point {
  if (ops.length === 0) return { x: 0, y: 0 };
  const lastOp = ops[ops.length - 1];
  return getFinalPositionFromMoves(lastOp.moves) || { x: 0, y: 0 };
}

/**
 * Walk `moves` backwards looking for the latest rapid or linear move;
 * returns its destination, or null when none found. Laser on/off,
 * dwell, air-assist toggles, and Z-only moves don't carry an X/Y
 * destination.
 */
export function getFinalPositionFromMoves(moves: Move[]): Point | null {
  for (let i = moves.length - 1; i >= 0; i--) {
    const move = moves[i];
    if (move.type === 'rapid' || move.type === 'linear') {
      return { ...move.to };
    }
  }
  return null;
}

/**
 * AABB covering every `rapid` / `linear` destination in `plan`'s
 * operations. Non-motion moves (laserOn/Off, dwell, etc.) are ignored.
 * Returns the empty AABB sentinel when no positional moves exist.
 */
export function computePlanBounds(plan: Plan): AABB {
  let bounds = emptyAABB();

  for (const op of plan.operations) {
    for (const move of op.moves) {
      if (move.type === 'rapid' || move.type === 'linear') {
        bounds = mergeAABB(bounds, {
          minX: move.to.x, minY: move.to.y,
          maxX: move.to.x, maxY: move.to.y,
        });
      }
    }
  }

  return bounds;
}
