// corner-geometry — the maths both corner operations share (ADR-271, DS-6).
//
// A corner is three consecutive points A-B-C. Fillet and chamfer both cut the same
// distance back along BA and BC and then differ only in what replaces the removed
// tip: a tangent arc, or a straight line. Deriving that setback once means the two
// operations cannot disagree about where the corner ends.
//
// Returns null rather than throwing for every geometrically impossible case —
// collinear points, a doubled vertex, a setback longer than either leg. Null means
// "this corner cannot take that size", which the UI reports and never treats as an
// error (rule 7).

import type { Vec2 } from '../../scene';

export type CornerSetback = {
  // Where the corner leaves the incoming leg, heading back toward A.
  readonly startMm: Vec2;
  // Where it rejoins the outgoing leg, heading toward C.
  readonly endMm: Vec2;
  // The interior angle at B, in radians, always in (0, PI).
  readonly interiorRad: number;
  // Unit vectors from B toward A and toward C.
  readonly towardPrevious: Vec2;
  readonly towardNext: Vec2;
};

// Below this the legs are effectively collinear or reversed and no corner exists.
const MIN_INTERIOR_RAD = 1e-6;
const MIN_LEG_MM = 1e-9;

/**
 * Cuts `setbackMm` back along both legs of the corner at B.
 *
 * Null when the corner is degenerate or the setback does not fit on either leg —
 * a fillet or chamfer that would consume a whole neighbouring segment is refused
 * rather than silently clamped, because clamping would move geometry the operator
 * did not ask to move.
 */
export function cornerSetback(
  previousMm: Vec2,
  cornerMm: Vec2,
  nextMm: Vec2,
  setbackMm: number,
): CornerSetback | null {
  if (!Number.isFinite(setbackMm) || setbackMm <= 0) return null;
  const toPrevious = subtract(previousMm, cornerMm);
  const toNext = subtract(nextMm, cornerMm);
  const previousLength = length(toPrevious);
  const nextLength = length(toNext);
  if (previousLength < MIN_LEG_MM || nextLength < MIN_LEG_MM) return null;
  if (setbackMm > previousLength || setbackMm > nextLength) return null;
  const towardPrevious = scale(toPrevious, 1 / previousLength);
  const towardNext = scale(toNext, 1 / nextLength);
  const interiorRad = angleBetween(towardPrevious, towardNext);
  if (interiorRad < MIN_INTERIOR_RAD || interiorRad > Math.PI - MIN_INTERIOR_RAD) return null;
  return {
    startMm: add(cornerMm, scale(towardPrevious, setbackMm)),
    endMm: add(cornerMm, scale(towardNext, setbackMm)),
    interiorRad,
    towardPrevious,
    towardNext,
  };
}

/**
 * The setback a fillet of `radiusMm` needs at an interior angle of `interiorRad`.
 *
 * Standard tangent length: t = r / tan(theta / 2). A sharper corner needs a longer
 * setback for the same radius, which is why a fillet can fail on a short leg where
 * a chamfer of the same size succeeds.
 */
export function filletSetbackMm(radiusMm: number, interiorRad: number): number | null {
  if (!Number.isFinite(radiusMm) || radiusMm <= 0) return null;
  const half = interiorRad / 2;
  const tangent = Math.tan(half);
  if (!Number.isFinite(tangent) || Math.abs(tangent) < MIN_LEG_MM) return null;
  return radiusMm / tangent;
}

/**
 * Centre of the fillet arc: out along the bisector from the corner by
 * r / sin(theta / 2).
 */
export function filletCentreMm(
  cornerMm: Vec2,
  setback: CornerSetback,
  radiusMm: number,
): Vec2 | null {
  const half = setback.interiorRad / 2;
  const sine = Math.sin(half);
  if (Math.abs(sine) < MIN_LEG_MM) return null;
  const bisector = normalize(add(setback.towardPrevious, setback.towardNext));
  if (bisector === null) return null;
  return add(cornerMm, scale(bisector, radiusMm / sine));
}

export function angleOfMm(fromMm: Vec2, toMm: Vec2): number {
  return Math.atan2(toMm.y - fromMm.y, toMm.x - fromMm.x);
}

// Signed shortest turn from `fromRad` to `toRad`, in (-PI, PI]. This is the arc
// sweep, and its sign is the direction the fillet must be drawn.
export function shortestSweepRad(fromRad: number, toRad: number): number {
  const raw = (toRad - fromRad) % (Math.PI * 2);
  if (raw > Math.PI) return raw - Math.PI * 2;
  if (raw <= -Math.PI) return raw + Math.PI * 2;
  return raw;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(a: Vec2, factor: number): Vec2 {
  return { x: a.x * factor, y: a.y * factor };
}

function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

function normalize(a: Vec2): Vec2 | null {
  const magnitude = length(a);
  return magnitude < MIN_LEG_MM ? null : scale(a, 1 / magnitude);
}

function angleBetween(unitA: Vec2, unitB: Vec2): number {
  const dot = Math.min(1, Math.max(-1, unitA.x * unitB.x + unitA.y * unitB.y));
  return Math.acos(dot);
}
