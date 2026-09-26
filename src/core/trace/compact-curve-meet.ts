// Whether two pieces of fitted outline curves meet (ADR-441).
//
// A piece is a cubic Bézier or a straight line (a cubic with its control
// points on the chord). Its control points bound it: the curve lies in their
// convex hull, so inside their bounding box, and never further from its chord
// than the farther inner control point. Two pieces are tested by halving
// (de Casteljau at t = 1/2) whichever is larger until their boxes separate,
// which proves they do not meet, or both are within LEAF_FLATNESS_PX of their
// chords, where two chords closer than the two flatnesses count as meeting.
// A meeting is therefore reported for every crossing and every touch, and for
// curves that pass within 2 x LEAF_FLATNESS_PX of each other: the test never
// misses a contact, it may only round a near miss of 1/5000 px up to one.
// (Past MAX_DEPTH halvings a pair is decided on its chords as they are.)
//
// Two pieces that share a joint (the end of one is the start of the other)
// always meet there; they are tested for meeting ANYWHERE ELSE. The halves
// that keep the joint keep the flag, and a pair of leaves at the joint is not
// a meeting. When a line through the joint separates the two pieces'
// remaining control points, they meet only at the joint, which ends the test
// at the first level for every smooth joint.
//
// A piece meets itself when it forms a loop. A cubic whose control points run
// monotonically along its chord is injective (its derivative along the chord
// never changes sign), so only non-monotone pieces are halved and their
// halves tested against each other as a joint-sharing pair.
//
// Own design from standard Bézier properties (convex hull, subdivision).

import type { Vec2 } from '../scene';

export type CurvePiece = {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
};

// Leaf flatness, px of the working grid.
const LEAF_FLATNESS_PX = 1e-4;
// Halvings of the two pieces together before a pair is decided as leaves.
const MAX_DEPTH = 48;

/** A straight piece from a to b, as a cubic. */
export function linePiece(a: Vec2, b: Vec2): CurvePiece {
  return { p0: a, p1: a, p2: b, p3: b };
}

/** The bounding box of a piece's control points: it contains the piece. */
export function pieceBox(piece: CurvePiece): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const { p0, p1, p2, p3 } = piece;
  return {
    minX: Math.min(p0.x, p1.x, p2.x, p3.x),
    minY: Math.min(p0.y, p1.y, p2.y, p3.y),
    maxX: Math.max(p0.x, p1.x, p2.x, p3.x),
    maxY: Math.max(p0.y, p1.y, p2.y, p3.y),
  };
}

/**
 * Whether `a` and `b` cross or touch. With `sharedJoint`, `a` ends where `b`
 * starts and meeting at that joint does not count.
 */
export function piecesMeet(a: CurvePiece, b: CurvePiece, sharedJoint: boolean): boolean {
  return meet(part(a.p0, a.p1, a.p2, a.p3), part(b.p0, b.p1, b.p2, b.p3), sharedJoint, 0);
}

/** Whether a piece crosses or touches itself away from its own ends. */
export function pieceMeetsItself(piece: CurvePiece): boolean {
  return selfMeet(part(piece.p0, piece.p1, piece.p2, piece.p3), 0);
}

// A piece during subdivision, with its box (pieceBox) and, once measured,
// its flatness: a piece kept while the other is halved is not measured again.
type Part = CurvePiece & {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  flat: number;
};

function part(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): Part {
  return {
    p0,
    p1,
    p2,
    p3,
    minX: Math.min(p0.x, p1.x, p2.x, p3.x),
    minY: Math.min(p0.y, p1.y, p2.y, p3.y),
    maxX: Math.max(p0.x, p1.x, p2.x, p3.x),
    maxY: Math.max(p0.y, p1.y, p2.y, p3.y),
    flat: Number.NaN,
  };
}

// NaN until measured; a NaN flatness is measured again, to the same NaN.
function flatnessOf(piece: Part): number {
  if (Number.isNaN(piece.flat)) piece.flat = flatness(piece);
  return piece.flat;
}

function meet(a: Part, b: Part, shared: boolean, depth: number): boolean {
  if (!partsOverlap(a, b)) return false;
  if (shared && separatedAtJoint(a, b)) return false;
  const flatA = flatnessOf(a);
  const flatB = flatnessOf(b);
  if ((flatA <= LEAF_FLATNESS_PX && flatB <= LEAF_FLATNESS_PX) || depth >= MAX_DEPTH) {
    // Leaves at a shared joint meet there, which does not count.
    return !shared && chordDistance(a, b) <= flatA + flatB;
  }
  if (halveFirst(a, b, flatA, flatB)) {
    const [left, right] = halve(a);
    // Only the right half of `a` keeps the joint it shares with `b`.
    return meet(left, b, false, depth + 1) || meet(right, b, shared, depth + 1);
  }
  const [left, right] = halve(b);
  return meet(a, left, shared, depth + 1) || meet(a, right, false, depth + 1);
}

function partsOverlap(a: Part, b: Part): boolean {
  return a.maxX >= b.minX && b.maxX >= a.minX && a.maxY >= b.minY && b.maxY >= a.minY;
}

// Halve a piece that is not yet flat; of two, the larger.
function halveFirst(a: Part, b: Part, flatA: number, flatB: number): boolean {
  if (flatB <= LEAF_FLATNESS_PX) return true;
  return flatA > LEAF_FLATNESS_PX && span(a) >= span(b);
}

function selfMeet(piece: Part, depth: number): boolean {
  if (depth >= MAX_DEPTH || flatnessOf(piece) <= LEAF_FLATNESS_PX) return false;
  if (monotoneAlongChord(piece)) return false;
  const [left, right] = halve(piece);
  return (
    meet(left, right, true, depth + 1) || selfMeet(left, depth + 1) || selfMeet(right, depth + 1)
  );
}

// A line through the joint J = a.p3 = b.p0 with `a` on one side and `b` on
// the other meets them only at J. Every point of `a` before J weighs its
// start a.p0 positively, so a.p0 strictly on its side and a.p1, a.p2 on it or
// on the line put all of `a` but J strictly on that side; likewise `b`.
// Tried across the chords and the joint tangents.
function separatedAtJoint(a: CurvePiece, b: CurvePiece): boolean {
  const joint = a.p3;
  const directions: ReadonlyArray<readonly [Vec2, Vec2]> = [
    [a.p0, joint],
    [joint, b.p3],
    [a.p0, b.p3],
    [a.p2, joint],
    [joint, b.p1],
  ];
  return directions.some(([from, to]) => {
    const ux = to.x - from.x;
    const uy = to.y - from.y;
    if (ux === 0 && uy === 0) return false;
    const side = (p: Vec2): number => (p.x - joint.x) * ux + (p.y - joint.y) * uy;
    return (
      side(a.p0) < 0 &&
      side(a.p1) <= 0 &&
      side(a.p2) <= 0 &&
      side(b.p3) > 0 &&
      side(b.p1) >= 0 &&
      side(b.p2) >= 0
    );
  });
}

// The projections of the control points onto the chord never decrease, so
// neither does the curve's: it cannot return to a point it passed.
function monotoneAlongChord(piece: CurvePiece): boolean {
  const { p0, p1, p2, p3 } = piece;
  const ux = p3.x - p0.x;
  const uy = p3.y - p0.y;
  if (ux === 0 && uy === 0) return false;
  const along = (p: Vec2): number => (p.x - p0.x) * ux + (p.y - p0.y) * uy;
  return along(p1) >= 0 && along(p2) >= along(p1) && along(p3) >= along(p2);
}

function flatness(piece: CurvePiece): number {
  return Math.max(
    pointSegmentDistance(piece.p1, piece.p0, piece.p3),
    pointSegmentDistance(piece.p2, piece.p0, piece.p3),
  );
}

function span(piece: Part): number {
  return Math.max(piece.maxX - piece.minX, piece.maxY - piece.minY);
}

function halve(piece: CurvePiece): [Part, Part] {
  const { p0, p1, p2, p3 } = piece;
  const p01 = mid(p0, p1);
  const p12 = mid(p1, p2);
  const p23 = mid(p2, p3);
  const p012 = mid(p01, p12);
  const p123 = mid(p12, p23);
  const p0123 = mid(p012, p123);
  return [part(p0, p01, p012, p0123), part(p0123, p123, p23, p3)];
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Distance between the chords p0-p3 of two pieces.
function chordDistance(a: CurvePiece, b: CurvePiece): number {
  if (chordsCross(a.p0, a.p3, b.p0, b.p3)) return 0;
  return Math.min(
    pointSegmentDistance(a.p0, b.p0, b.p3),
    pointSegmentDistance(a.p3, b.p0, b.p3),
    pointSegmentDistance(b.p0, a.p0, a.p3),
    pointSegmentDistance(b.p3, a.p0, a.p3),
  );
}

function chordsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (o: Vec2, p: Vec2, q: Vec2): number =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
}
