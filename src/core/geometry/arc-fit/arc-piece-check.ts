// Exact two-sided deviation check between one fitted primitive and the piece
// of sampled source it replaces (ADR-407). `points` is the source polyline
// from the primitive's start to its end.
//
// Line: distance to a segment is a convex function, so along each source chord
// it peaks at the chord's ends; checking every source point bounds the source
// against the line. The source is a continuous path between the line's two
// ends, so it passes every perpendicular of the line, and the point it passes
// there is within the same bound; that bounds the line against the source.
//
// Arc (sweep below a half turn, so its sector is convex): every source point
// must lie inside the sector, within the bound of the circle. A chord between
// two points of a convex sector stays in it, and its distance from the circle
// peaks at an end or, inside the circle, at the foot of the perpendicular from
// the centre, which is checked too. The source runs continuously from the
// arc's start ray to its end ray, so it crosses every ray between them within
// the bound of the circle, which bounds the arc against the source.

import type { Vec2 } from '../../scene';
import { GRBL_STOCK_ARC_TOLERANCE_MM } from './arc-fit-limits';
import type { FitArc, FitPrimitive } from './arc-primitives';

// Source samples share coordinates with the primitive's end points, so the
// sector test only needs room for floating-point noise.
const ANGLE_EPSILON_RAD = 1e-9;

/**
 * A piece of source polyline without copying it: points[from..to], with an
 * optional extra point before (head) and after (tail).
 */
export type SourcePiece = {
  readonly points: ReadonlyArray<Vec2>;
  readonly from: number;
  readonly to: number;
  readonly head?: Vec2;
  readonly tail?: Vec2;
};

export function primitiveFitsPoints(
  primitive: FitPrimitive,
  points: ReadonlyArray<Vec2>,
  toleranceMm: number,
): boolean {
  return primitiveFitsPiece(primitive, { points, from: 0, to: points.length - 1 }, toleranceMm);
}

export function primitiveFitsPiece(
  primitive: FitPrimitive,
  piece: SourcePiece,
  toleranceMm: number,
): boolean {
  return primitive.kind === 'line'
    ? lineFits(primitive.start, primitive.end, piece, toleranceMm)
    : arcFits(primitive, piece, toleranceMm);
}

function pieceLength(piece: SourcePiece): number {
  const extra = (piece.head === undefined ? 0 : 1) + (piece.tail === undefined ? 0 : 1);
  return piece.to - piece.from + 1 + extra;
}

function pieceAt(piece: SourcePiece, index: number): Vec2 {
  let offset = index;
  if (piece.head !== undefined) {
    if (offset === 0) return piece.head;
    offset -= 1;
  }
  const at = piece.from + offset;
  return at <= piece.to ? (piece.points[at] as Vec2) : (piece.tail as Vec2);
}

function lineFits(start: Vec2, end: Vec2, piece: SourcePiece, toleranceMm: number): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (!(lengthSq > 0)) return false;
  const limitSq = toleranceMm * toleranceMm;
  const count = pieceLength(piece);
  for (let index = 0; index < count; index += 1) {
    const point = pieceAt(piece, index);
    const px = point.x - start.x;
    const py = point.y - start.y;
    const t = Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSq));
    const ex = px - t * dx;
    const ey = py - t * dy;
    if (ex * ex + ey * ey > limitSq) return false;
  }
  return true;
}

// The controller runs the arc as chords sagging up to this far inside it.
function arcFits(arc: FitArc, piece: SourcePiece, moveToleranceMm: number): boolean {
  const toleranceMm = moveToleranceMm - controllerChordSagMm(arc.radius, arc.sweep);
  if (!(toleranceMm > 0)) return false;
  const sx = arc.start.x - arc.center.x;
  const sy = arc.start.y - arc.center.y;
  const direction = arc.clockwise ? -1 : 1;
  const count = pieceLength(piece);
  let previous: Vec2 | null = null;
  for (let index = 0; index < count; index += 1) {
    const point = pieceAt(piece, index);
    const vx = point.x - arc.center.x;
    const vy = point.y - arc.center.y;
    if (Math.abs(Math.hypot(vx, vy) - arc.radius) > toleranceMm) return false;
    const phi = direction * Math.atan2(sx * vy - sy * vx, sx * vx + sy * vy);
    if (phi < -ANGLE_EPSILON_RAD || phi > arc.sweep + ANGLE_EPSILON_RAD) return false;
    if (previous !== null && chordSagsInside(arc, previous, point, toleranceMm)) return false;
    previous = point;
  }
  return true;
}

// Whether the chord comes closer to the centre than the radius minus the
// bound anywhere between its ends.
function chordSagsInside(arc: FitArc, from: Vec2, to: Vec2, toleranceMm: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (!(lengthSq > 0)) return false;
  const t = ((arc.center.x - from.x) * dx + (arc.center.y - from.y) * dy) / lengthSq;
  if (t <= 0 || t >= 1) return false;
  const footDistance = Math.hypot(from.x + t * dx - arc.center.x, from.y + t * dy - arc.center.y);
  return arc.radius - footDistance > toleranceMm;
}

/**
 * The sag of the chords a GRBL-family controller cuts an arc into at the stock
 * `$12`: mc_arc takes floor(|0.5 sweep r| / sqrt($12 (2r - $12))) equal chords,
 * and a count of 0 or 1 is a single straight move to the end.
 */
export function controllerChordSagMm(radiusMm: number, sweepRad: number): number {
  const tolerance = GRBL_STOCK_ARC_TOLERANCE_MM;
  const denominator = Math.sqrt(tolerance * (2 * radiusMm - tolerance));
  const segments = denominator > 0 ? Math.floor((0.5 * sweepRad * radiusMm) / denominator) : 0;
  return radiusMm * (1 - Math.cos(sweepRad / (2 * Math.max(1, segments))));
}
