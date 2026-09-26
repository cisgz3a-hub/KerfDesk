// One ring of fitted outline cut into pieces for the curve crossing guard
// (ADR-406, compact-curve-contacts.ts).
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
import type { TraceSteps } from './trace-steps';

/** A piece and its position along its ring. */
export type Piece = ContourBox & CurvePiece & { readonly index: number };

export type RingPieces = ContourBox & {
  readonly id: number;
  readonly cubics: ReadonlyArray<Piece>;
  /** [ax, ay, bx, by, index] per straight piece. */
  readonly straights: ReadonlyArray<number>;
  readonly count: number;
  readonly closed: boolean;
  cubicIndex?: ContourBoxIndex<Piece>;
  straightIndex?: ContourBoxIndex<Piece>;
  /** Whether the ring meets itself, once tested. */
  meetsItself?: boolean;
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

/** The pieces of a ring, or null when it has none. */
export function* ringPiecesSteps(polyline: Polyline, id: number): TraceSteps<RingPieces | null> {
  const cooperate = yield;
  const curve = traceRingCurve(polyline);
  const curved =
    curve !== undefined && curve.segments.every((segment) => segment.kind !== 'elliptical-arc');
  const cut = curved ? curvePieces(curve) : straightPieces(polyline.points, polyline.closed);
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
    else cubics.push({ ...piece, ...box, index });
  }
  return { ...bounds, id, cubics, straights, count: raw.length, closed: polyline.closed };
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
  ring.straightIndex ??= ContourBoxIndex.create(
    Array.from({ length: packed.length / STRIDE }, (_, k) => straightPiece(packed, k * STRIDE)),
  );
  return ring.straightIndex.query(box);
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
