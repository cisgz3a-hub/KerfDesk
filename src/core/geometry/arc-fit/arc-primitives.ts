// Line and circular-arc primitives for arc fitting (ADR-432), with the three
// constructions the fitter uses: the arc leaving a point along a tangent
// through a second point, the arc through two points about a given centre,
// and a straight line. Every constructor applies the radius and sweep limits.

import type { Vec2 } from '../../scene';
import {
  ARC_FIT_MAX_RADIUS_MM,
  ARC_FIT_MAX_SWEEP_RAD,
  ARC_FIT_MIN_RADIUS_MM,
} from './arc-fit-limits';

export type FitLine = { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 };

export type FitArc = {
  readonly kind: 'arc';
  readonly start: Vec2;
  readonly end: Vec2;
  readonly center: Vec2;
  readonly radius: number;
  readonly clockwise: boolean;
  /** Unsigned sweep from start to end in the arc's direction, radians. */
  readonly sweep: number;
};

export type FitPrimitive = FitLine | FitArc;

const FULL_TURN = Math.PI * 2;
const LENGTH_EPSILON_MM = 1e-9;

export function fitLine(start: Vec2, end: Vec2): FitLine {
  return { kind: 'line', start, end };
}

/**
 * The circle leaving `start` along the unit `tangent` and passing through
 * `end`. A radius past the fitting limit reads as a straight line; a sweep past
 * a half turn, a tiny radius, or an end behind the tangent has no primitive.
 */
export function arcLeavingAlong(start: Vec2, tangent: Vec2, end: Vec2): FitPrimitive | null {
  const wx = end.x - start.x;
  const wy = end.y - start.y;
  const chordSq = wx * wx + wy * wy;
  if (chordSq <= LENGTH_EPSILON_MM * LENGTH_EPSILON_MM) return null;
  const along = wx * tangent.x + wy * tangent.y;
  if (along <= 0) return null;
  // Left normal of the tangent; the signed offset of the chord along it decides
  // the side of the centre and so the direction.
  const across = -wx * tangent.y + wy * tangent.x;
  if (Math.abs(across) * 2 * ARC_FIT_MAX_RADIUS_MM <= chordSq) return fitLine(start, end);
  const signedRadius = chordSq / (2 * across);
  const radius = Math.abs(signedRadius);
  if (radius < ARC_FIT_MIN_RADIUS_MM) return null;
  const sweep = 2 * Math.atan2(Math.abs(across), along);
  if (sweep > ARC_FIT_MAX_SWEEP_RAD) return null;
  return {
    kind: 'arc',
    start,
    end,
    center: {
      x: start.x - tangent.y * signedRadius,
      y: start.y + tangent.x * signedRadius,
    },
    radius,
    clockwise: across < 0,
    sweep,
  };
}

/** The arc from `start` to `end` about `center`, radius taken at the start. */
export function arcAbout(start: Vec2, end: Vec2, center: Vec2, clockwise: boolean): FitArc | null {
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  if (!Number.isFinite(radius)) return null;
  if (radius < ARC_FIT_MIN_RADIUS_MM || radius > ARC_FIT_MAX_RADIUS_MM) return null;
  const sweep = arcSweep(start, end, center, clockwise);
  if (sweep > ARC_FIT_MAX_SWEEP_RAD) return null;
  return { kind: 'arc', start, end, center, radius, clockwise, sweep };
}

/** Unsigned sweep in (0, 2π] from start to end about the centre. */
export function arcSweep(start: Vec2, end: Vec2, center: Vec2, clockwise: boolean): number {
  const ax = start.x - center.x;
  const ay = start.y - center.y;
  const bx = end.x - center.x;
  const by = end.y - center.y;
  const angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  const directed = clockwise ? -angle : angle;
  return directed <= 0 ? directed + FULL_TURN : directed;
}

export function reversePrimitive(primitive: FitPrimitive): FitPrimitive {
  if (primitive.kind === 'line') return fitLine(primitive.end, primitive.start);
  return {
    ...primitive,
    start: primitive.end,
    end: primitive.start,
    clockwise: !primitive.clockwise,
  };
}

/** Unit tangent of a primitive at its end, in the direction of travel. */
export function primitiveEndTangent(primitive: FitPrimitive): Vec2 {
  if (primitive.kind === 'line')
    return unit(primitive.end.x - primitive.start.x, primitive.end.y - primitive.start.y);
  return arcTangentAt(primitive, primitive.end);
}

/** Unit tangent of a primitive at its start, in the direction of travel. */
export function primitiveStartTangent(primitive: FitPrimitive): Vec2 {
  if (primitive.kind === 'line')
    return unit(primitive.end.x - primitive.start.x, primitive.end.y - primitive.start.y);
  return arcTangentAt(primitive, primitive.start);
}

function arcTangentAt(arc: FitArc, point: Vec2): Vec2 {
  const rx = point.x - arc.center.x;
  const ry = point.y - arc.center.y;
  // Counter-clockwise travel runs along the left normal of the radius.
  return arc.clockwise ? unit(ry, -rx) : unit(-ry, rx);
}

export function unit(x: number, y: number): Vec2 {
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}
