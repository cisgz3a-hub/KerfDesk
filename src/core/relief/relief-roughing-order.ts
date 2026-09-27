// The order relief roughing cuts one level's rings in, and the side of each
// ring its stock lies on (ADR-424).
//
// The ring ladder steps inward from the level's region boundary. Cutting it
// outside in slots the longest ring, the boundary, at the full cutter width,
// and leaves every later ring its stock on the inner side, which the pocket
// winding rule reads as conventional. Cutting each connected piece inside out
// instead enters at the piece's middle, where the rings are shortest, and
// widens the cleared area one stepover at a time out to the boundary, as the
// pocket planner does. Every ring after the first then meets its stock on the
// side toward the region boundary: outside an outer contour, inside the
// contour around an island.
//
// Rings of one offset step never cross, so the even-odd count of the other
// loops containing a loop says whether it bounds its piece from outside or an
// island inside it. A piece one step in lies inside exactly one piece of the
// step before, which gives the tree the inside-out order walks: a piece is cut
// once every piece inside it is (relief-roughing-motion.ts).

import { pointInPolygon } from '../geometry/point-in-polygon';
import type { Polyline, Vec2 } from '../scene';

const MIN_LOOP_POINTS = 3;

export type RoughingLoop = {
  // The loop's vertices without a repeated closing point.
  readonly points: ReadonlyArray<Vec2>;
  // True when the stock this loop cuts lies inside it.
  readonly stockInside: boolean;
};

type Piece = {
  readonly outer: ReadonlyArray<Vec2>;
  readonly holes: ReadonlyArray<ReadonlyArray<Vec2>>;
};

/** The vertices of a closed loop, without a repeated closing point. */
export function openLoop(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 2 || first === undefined || last === undefined) return points;
  return first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
}

/** Whether each loop bounds a hole: contained by an odd number of the others.
 * The loops must not cross one another, as offset rings and the pieces of a
 * polygon difference never do. */
export function evenOddHoles(loops: ReadonlyArray<ReadonlyArray<Vec2>>): ReadonlyArray<boolean> {
  return loops.map((_, index) => containingLoops(loops, index).length % 2 === 1);
}

export type RingPiece = {
  // The piece's outer contour first, then the contours of its islands.
  readonly loops: ReadonlyArray<RoughingLoop>;
  // The piece one offset step out that contains this one; null on the first
  // step, or where no piece of the step before contains it.
  readonly parent: number | null;
};

/** One level's rings as connected pieces, each linked to the piece one step
 * out that contains it: the tree an inside-out order walks. */
export function ringPieces(
  rings: ReadonlyArray<ReadonlyArray<Polyline>>,
): ReadonlyArray<RingPiece> {
  const pieces: RingPiece[] = [];
  let outer: ReadonlyArray<{ readonly index: number; readonly piece: Piece }> = [];
  for (const ring of rings) {
    const step = stepPieces(ring).map((piece) => {
      const probe = piece.outer[0];
      const parent =
        probe === undefined ? undefined : outer.find((o) => pieceContains(o.piece, probe));
      pieces.push({
        loops: [
          { points: piece.outer, stockInside: false },
          ...piece.holes.map((hole) => ({ points: hole, stockInside: true })),
        ],
        parent: parent?.index ?? null,
      });
      return { index: pieces.length - 1, piece };
    });
    outer = step;
  }
  return pieces;
}

/** A walk of the piece tree inside out: each call returns, of the pieces
 * whose inner pieces have all been returned, the one with a loop nearest
 * `from` by `distance` (the first when `from` is undefined), until none is
 * left. Pieces whose bounds lie no nearer than the best so far are skipped
 * unmeasured. */
export function insideOutNearest(
  pieces: ReadonlyArray<RingPiece>,
  distance: (points: ReadonlyArray<Vec2>, from: Vec2) => number,
): (from: Vec2 | undefined) => RingPiece | undefined {
  const bounds = pieces.map((piece) => boundsOf(piece.loops[0]?.points ?? []));
  const inner = pieces.map(() => 0);
  for (const piece of pieces) {
    if (piece.parent !== null) inner[piece.parent] = (inner[piece.parent] ?? 0) + 1;
  }
  const ready = pieces.flatMap((_, index) => (inner[index] === 0 ? [index] : []));
  return (from) => {
    const position = from === undefined ? 0 : nearestReady(pieces, bounds, ready, from, distance);
    const [index] = ready.splice(position, 1);
    const piece = index === undefined ? undefined : pieces[index];
    const parent = piece?.parent ?? null;
    if (parent !== null) {
      inner[parent] = (inner[parent] ?? 0) - 1;
      if (inner[parent] === 0) ready.push(parent);
    }
    return piece;
  };
}

function nearestReady(
  pieces: ReadonlyArray<RingPiece>,
  bounds: ReadonlyArray<Bounds>,
  ready: ReadonlyArray<number>,
  from: Vec2,
  distance: (points: ReadonlyArray<Vec2>, from: Vec2) => number,
): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let position = 0; position < ready.length; position += 1) {
    const index = ready[position] ?? -1;
    const box = bounds[index];
    if (box === undefined || boundsDistance(box, from) >= bestDistance) continue;
    for (const loop of pieces[index]?.loops ?? []) {
      const d = distance(loop.points, from);
      if (d < bestDistance) {
        bestDistance = d;
        best = position;
      }
    }
  }
  return best;
}

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

// A piece's outer contour bounds its islands too.
function boundsOf(points: ReadonlyArray<Vec2>): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function boundsDistance(box: Bounds, from: Vec2): number {
  const dx = Math.max(box.minX - from.x, 0, from.x - box.maxX);
  const dy = Math.max(box.minY - from.y, 0, from.y - box.maxY);
  return Math.hypot(dx, dy);
}

function stepPieces(ring: ReadonlyArray<Polyline>): ReadonlyArray<Piece> {
  const loops = ring
    .map((polyline) => openLoop(polyline.points))
    .filter((points) => points.length >= MIN_LOOP_POINTS);
  const containers = loops.map((_, index) => containingLoops(loops, index));
  const pieces = new Map<number, { outer: ReadonlyArray<Vec2>; holes: ReadonlyArray<Vec2>[] }>();
  loops.forEach((loop, index) => {
    if ((containers[index] ?? []).length % 2 === 0) pieces.set(index, { outer: loop, holes: [] });
  });
  loops.forEach((loop, index) => {
    const around = containers[index] ?? [];
    if (around.length % 2 === 0) return;
    // A hole belongs to the containing outer contour one level up: the one
    // among its containers that the others also contain.
    const owner = around.find(
      (candidate) => (containers[candidate] ?? []).length === around.length - 1,
    );
    if (owner !== undefined) pieces.get(owner)?.holes.push(loop);
  });
  return [...pieces.values()];
}

function containingLoops(loops: ReadonlyArray<ReadonlyArray<Vec2>>, index: number): number[] {
  const probe = loops[index]?.[0];
  if (probe === undefined) return [];
  const around: number[] = [];
  loops.forEach((other, otherIndex) => {
    if (otherIndex !== index && pointInPolygon(probe, other)) around.push(otherIndex);
  });
  return around;
}

function pieceContains(piece: Piece, point: Vec2): boolean {
  return pointInPolygon(point, piece.outer) && !piece.holes.some((h) => pointInPolygon(point, h));
}
