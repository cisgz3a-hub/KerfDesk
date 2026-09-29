// One ring of fitted outline cut into pieces for the curve crossing guard
// (ADR-531, compact-curve-contacts.ts).
//
// A fitted ring becomes its line segments and its cubics halved to about
// PIECE_PX of control polygon; a ring without a fitted curve becomes its
// straight edges. Straight pieces are only ever tested against curved ones
// (the sample test sees straight against straight exactly), so they are
// packed as numbers and turned into objects only when a curved piece comes
// near. A ring with many pieces of a kind indexes them by box, built on first
// use; a small one, as most rings of a dense trace are, scans them.

import type { CurveSubpath, Polyline, Vec2 } from '../scene';
import { boxesOverlap, type ContourBox } from './contour-bounds';
import { ContourBoxIndex } from './contour-box-index';
import {
  linePiece,
  pieceBox,
  pieceMeetsItself,
  piecesMeet,
  type CurvePiece,
} from './compact-curve-meet';
import { traceRingCurve } from './trace-curves';
import { runTraceSteps, type TraceSteps } from './trace-steps';

/** A piece and its position along its ring. */
export type Piece = ContourBox & CurvePiece & { readonly index: number };

export type RingPieces = ContourBox & {
  readonly id: number;
  readonly cubics: ReadonlyArray<Piece>;
  /** [ax, ay, bx, by, index] per straight piece. */
  readonly straights: ReadonlyArray<number>;
  readonly count: number;
  readonly closed: boolean;
  /** Whether the ring had too few pieces and they were halved (atLeastPieces):
   *  a halved line piece is half a sample edge, so ringMeetsNeighbours does
   *  not apply. */
  readonly halved: boolean;
  cubicIndex?: ContourBoxIndex<Piece>;
  straightIndex?: ContourBoxIndex<Piece>;
};

// A cubic is cut into pieces about this long (control polygon, px).
const PIECE_PX = 3;
// A closed ring is cut into at least this many pieces, so two pieces share
// at most one joint.
const MIN_RING_PIECES = 4;
// Above this many pieces of a kind, a ring indexes them.
const INDEXED_PIECES = 16;
const STRIDE = 5;
const CHECKPOINT_PIECES = 256;

/** The fitted curve a ring's pieces are cut from, or undefined when they are
 *  its straight edges. */
export function piecesCurve(polyline: Polyline): CurveSubpath | undefined {
  const curve = traceRingCurve(polyline);
  const cuttable =
    curve !== undefined && curve.segments.every((segment) => segment.kind !== 'elliptical-arc');
  return cuttable ? curve : undefined;
}

/** The box of a ring whose pieces are its straight edges (no piecesCurve),
 *  which is its pieces' box, or null when it has no pieces: every point is
 *  the same. */
export function straightRingBox(points: ReadonlyArray<Vec2>): ContourBox | null {
  const first = points[0];
  if (first === undefined) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return minX === maxX && minY === maxY ? null : { minX, minY, maxX, maxY };
}

/** The pieces of a ring, or null when it has none. */
export function* ringPiecesSteps(polyline: Polyline, id: number): TraceSteps<RingPieces | null> {
  const cooperate = yield;
  const curve = piecesCurve(polyline);
  const cut =
    curve !== undefined ? curvePieces(curve) : straightPieces(polyline.points, polyline.closed);
  const raw = polyline.closed ? atLeastPieces(cut, MIN_RING_PIECES) : cut;
  if (raw.length === 0) return null;
  const cubics: Piece[] = [];
  const straights: number[] = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [index, piece] of raw.entries()) {
    if (cooperate && index % CHECKPOINT_PIECES === 0) yield;
    const box = pieceBox(piece);
    bounds.minX = Math.min(bounds.minX, box.minX);
    bounds.minY = Math.min(bounds.minY, box.minY);
    bounds.maxX = Math.max(bounds.maxX, box.maxX);
    bounds.maxY = Math.max(bounds.maxY, box.maxY);
    if (isStraight(piece)) straights.push(piece.p0.x, piece.p0.y, piece.p3.x, piece.p3.y, index);
    // Written out rather than spread: a literal of known shape keeps every
    // field in the object, where a spread moves some to a property array.
    else {
      const { p0, p1, p2, p3 } = piece;
      const { minX, minY, maxX, maxY } = box;
      cubics.push({ p0, p1, p2, p3, minX, minY, maxX, maxY, index });
    }
  }
  const halved = raw !== cut;
  return { ...bounds, id, cubics, straights, count: raw.length, closed: polyline.closed, halved };
}

/** Whether the ring's curves cross or touch themselves. */
export function ringMeetsItself(ring: RingPieces): boolean {
  for (const piece of ring.cubics) {
    if (pieceMeetsItself(piece)) return true;
    for (const other of cubicsNear(ring, piece)) {
      if (other.index > piece.index && sameRingMeet(piece, other, ring)) return true;
    }
    for (const other of straightsNear(ring, piece)) {
      const [first, second] = other.index < piece.index ? [other, piece] : [piece, other];
      if (sameRingMeet(first, second, ring)) return true;
    }
  }
  return false;
}

/** ringMeetsItself for a ring whose sample edges stay apart except where
 *  they are neighbours: each cubic piece is tested against itself and the
 *  pieces one and two places from it along the ring, by the same rules. The
 *  pieces further apart cannot meet then (compact-curve-contacts.ts). Not for
 *  a ring whose pieces were halved. */
export function ringMeetsNeighbours(ring: RingPieces): boolean {
  const count = ring.count;
  // With fewer pieces, every two are within two places of each other.
  if (count < 6) return ringMeetsItself(ring);
  const slots = pieceSlots(ring);
  for (const piece of ring.cubics) {
    if (pieceMeetsItself(piece)) return true;
    for (const step of NEIGHBOUR_STEPS) {
      const index = (piece.index + step + count) % count;
      const slot = slots[index] as number;
      // Two cubics are tested once, from the lower index, as in
      // ringMeetsItself; a straight piece is tested from the cubic.
      if (slot >= 0 && index < piece.index) continue;
      const other =
        slot >= 0 ? (ring.cubics[slot] as Piece) : straightPiece(ring.straights, ~slot * STRIDE);
      const meets =
        index < piece.index ? sameRingMeet(other, piece, ring) : sameRingMeet(piece, other, ring);
      if (meets) return true;
    }
  }
  return false;
}

// The pieces one and two places along the ring, either way.
const NEIGHBOUR_STEPS = [1, 2, -1, -2];

// Each piece's place by its index along the ring: its position in `cubics`,
// or the bitwise complement of its position among the straight pieces.
function pieceSlots(ring: RingPieces): Int32Array {
  const slots = new Int32Array(ring.count);
  ring.cubics.forEach((piece, slot) => {
    slots[piece.index] = slot;
  });
  for (let slot = 0; slot * STRIDE < ring.straights.length; slot += 1) {
    slots[ring.straights[slot * STRIDE + 4] as number] = ~slot;
  }
  return slots;
}

/** Whether a curved piece of either ring meets any piece of the other. */
export function ringsMeet(a: RingPieces, b: RingPieces): boolean {
  if (!boxesOverlap(a, b)) return false;
  for (const piece of cubicsNear(a, b)) {
    for (const other of cubicsNear(b, piece)) if (piecesMeet(piece, other, false)) return true;
    for (const other of straightsNear(b, piece)) if (piecesMeet(piece, other, false)) return true;
  }
  for (const piece of cubicsNear(b, a)) {
    for (const other of straightsNear(a, piece)) if (piecesMeet(piece, other, false)) return true;
  }
  return false;
}

// `later` comes after `piece` in the ring; neighbours share a joint.
function sameRingMeet(piece: Piece, later: Piece, ring: RingPieces): boolean {
  if (later.index === piece.index + 1) return piecesMeet(piece, later, true);
  const wraps = ring.closed && piece.index === 0 && later.index === ring.count - 1;
  return wraps ? piecesMeet(later, piece, true) : piecesMeet(piece, later, false);
}

function cubicsNear(ring: RingPieces, box: ContourBox): ReadonlyArray<Piece> {
  if (ring.cubics.length <= INDEXED_PIECES) {
    return ring.cubics.filter((piece) => boxesOverlap(piece, box));
  }
  ring.cubicIndex ??= ContourBoxIndex.create(ring.cubics);
  return ring.cubicIndex.query(box);
}

function straightsNear(ring: RingPieces, box: ContourBox): ReadonlyArray<Piece> {
  const packed = ring.straights;
  if (packed.length <= INDEXED_PIECES * STRIDE) {
    const near: Piece[] = [];
    for (let at = 0; at < packed.length; at += STRIDE) {
      const ax = packed[at] as number;
      const ay = packed[at + 1] as number;
      const bx = packed[at + 2] as number;
      const by = packed[at + 3] as number;
      const overlaps =
        Math.max(ax, bx) >= box.minX &&
        box.maxX >= Math.min(ax, bx) &&
        Math.max(ay, by) >= box.minY &&
        box.maxY >= Math.min(ay, by);
      if (overlaps) near.push(straightPiece(packed, at));
    }
    return near;
  }
  ring.straightIndex ??= straightIndex(packed);
  return ring.straightIndex.query(box);
}

// The straight pieces indexed by their boxes, each made into a piece only when
// a query finds it: a long ring beside a few curves holds numbers, not one
// object per edge. The boxes are pieceBox's for a line.
function straightIndex(packed: ReadonlyArray<number>): ContourBoxIndex<Piece> {
  const count = packed.length / STRIDE;
  const bounds = new Float64Array(4 * count);
  for (let k = 0; k < count; k += 1) {
    const ax = packed[k * STRIDE] as number;
    const ay = packed[k * STRIDE + 1] as number;
    const bx = packed[k * STRIDE + 2] as number;
    const by = packed[k * STRIDE + 3] as number;
    bounds[4 * k] = Math.min(ax, bx);
    bounds[4 * k + 1] = Math.min(ay, by);
    bounds[4 * k + 2] = Math.max(ax, bx);
    bounds[4 * k + 3] = Math.max(ay, by);
  }
  return runTraceSteps(
    ContourBoxIndex.overBoundsSteps(bounds, (k) => straightPiece(packed, k * STRIDE)),
  );
}

function straightPiece(packed: ReadonlyArray<number>, at: number): Piece {
  const a = { x: packed[at] as number, y: packed[at + 1] as number };
  const b = { x: packed[at + 2] as number, y: packed[at + 3] as number };
  const piece = linePiece(a, b);
  return { ...piece, ...pieceBox(piece), index: packed[at + 4] as number };
}

function curvePieces(curve: CurveSubpath): CurvePiece[] {
  const out: CurvePiece[] = [];
  let current = curve.start;
  for (const segment of curve.segments) {
    if (segment.kind === 'cubic') {
      const cubic = { p0: current, p1: segment.control1, p2: segment.control2, p3: segment.to };
      // A cubic that returns to its start is cut, so no piece is a loop.
      const loops = samePoint(cubic.p0, cubic.p3) ? 2 : 1;
      out.push(...cutCubic(cubic, Math.max(loops, Math.ceil(polygonLength(cubic) / PIECE_PX))));
    } else if (!samePoint(current, segment.to)) {
      out.push(linePiece(current, segment.to));
    }
    current = segment.to;
  }
  if (curve.closed && !samePoint(current, curve.start)) out.push(linePiece(current, curve.start));
  return out;
}

function straightPieces(points: ReadonlyArray<Vec2>, closed: boolean): CurvePiece[] {
  const out: CurvePiece[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i] as Vec2;
    const b = points[i + 1] as Vec2;
    if (!samePoint(a, b)) out.push(linePiece(a, b));
  }
  const first = points[0];
  const last = points.at(-1);
  if (closed && first !== undefined && last !== undefined && !samePoint(first, last)) {
    out.push(linePiece(last, first));
  }
  return out;
}

// Halve every piece until there are at least `count`.
function atLeastPieces(pieces: CurvePiece[], count: number): CurvePiece[] {
  let out = pieces;
  while (out.length > 0 && out.length < count) {
    out = out.flatMap((piece) => {
      if (!isStraight(piece)) return cutCubic(piece, 2);
      const middle = mid(piece.p0, piece.p3);
      return [linePiece(piece.p0, middle), linePiece(middle, piece.p3)];
    });
  }
  return out;
}

// At least `count` pieces by repeated halving, so every cut is exact.
function cutCubic(cubic: CurvePiece, count: number): CurvePiece[] {
  if (count <= 1) return [cubic];
  const { p0, p1, p2, p3 } = cubic;
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  const half = Math.ceil(count / 2);
  return [
    ...cutCubic({ p0, p1: p01, p2: p012, p3: p0123 }, half),
    ...cutCubic({ p0: p0123, p1: p123, p2: p23, p3 }, half),
  ];
}

function isStraight(piece: CurvePiece): boolean {
  return samePoint(piece.p1, piece.p0) && samePoint(piece.p2, piece.p3);
}

function polygonLength(piece: CurvePiece): number {
  return (
    Math.hypot(piece.p1.x - piece.p0.x, piece.p1.y - piece.p0.y) +
    Math.hypot(piece.p2.x - piece.p1.x, piece.p2.y - piece.p1.y) +
    Math.hypot(piece.p3.x - piece.p2.x, piece.p3.y - piece.p2.y)
  );
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
