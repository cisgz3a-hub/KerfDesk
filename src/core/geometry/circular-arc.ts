import type { Vec2 } from '../scene';
import { sampleArcPoints } from './arc-sampling';

export type CircularArc2d = {
  readonly start: Vec2;
  readonly end: Vec2;
  readonly center: Vec2;
  readonly clockwise: boolean;
};

export type CircularArcGeometry =
  | {
      readonly kind: 'ok';
      readonly radiusMm: number;
      readonly startRad: number;
      readonly sweepRad: number;
    }
  | { readonly kind: 'invalid' };

// Match the GRBL-order tolerance used by the external G-code parser: 0.005 in.
export const CIRCULAR_ARC_RADIUS_TOLERANCE_MM = 0.127;

const AXIS_EPSILON_MM = 1e-9;
const FULL_TURN_RAD = Math.PI * 2;

export function circularArcGeometry(arc: CircularArc2d): CircularArcGeometry {
  if (!finitePoint(arc.start) || !finitePoint(arc.end) || !finitePoint(arc.center)) {
    return { kind: 'invalid' };
  }
  const radiusMm = distance(arc.start, arc.center);
  const endRadiusMm = distance(arc.end, arc.center);
  if (radiusMm <= AXIS_EPSILON_MM || endRadiusMm <= AXIS_EPSILON_MM) {
    return { kind: 'invalid' };
  }
  if (Math.abs(radiusMm - endRadiusMm) > CIRCULAR_ARC_RADIUS_TOLERANCE_MM) {
    return { kind: 'invalid' };
  }
  const startRad = Math.atan2(arc.start.y - arc.center.y, arc.start.x - arc.center.x);
  const endRad = Math.atan2(arc.end.y - arc.center.y, arc.end.x - arc.center.x);
  return {
    kind: 'ok',
    radiusMm,
    startRad,
    sweepRad: circularArcSweepRad(startRad, endRad, arc.clockwise, arc.start, arc.end),
  };
}

export function circularArcLengthMm(arc: CircularArc2d): number {
  const geometry = circularArcGeometry(arc);
  if (geometry.kind === 'invalid') return distance(arc.start, arc.end);
  return Math.abs(geometry.sweepRad) * geometry.radiusMm;
}

export function sampleCircularArcPoints(arc: CircularArc2d): Vec2[] {
  const geometry = circularArcGeometry(arc);
  if (geometry.kind === 'invalid') return linePoints(arc.start, arc.end);
  const points = sampleArcPoints(
    arc.center,
    geometry.radiusMm,
    geometry.startRad,
    geometry.sweepRad,
  );
  if (points.length < 2) return linePoints(arc.start, arc.end);
  points[0] = arc.start;
  points[points.length - 1] = arc.end;
  return points;
}

export function isCircularArcFullCircle(arc: CircularArc2d): boolean {
  return distance(arc.start, arc.end) <= AXIS_EPSILON_MM;
}

function circularArcSweepRad(
  startRad: number,
  endRad: number,
  clockwise: boolean,
  start: Vec2,
  end: Vec2,
): number {
  if (distance(start, end) <= AXIS_EPSILON_MM) {
    return clockwise ? -FULL_TURN_RAD : FULL_TURN_RAD;
  }
  let sweepRad = endRad - startRad;
  if (clockwise) {
    while (sweepRad >= 0) sweepRad -= FULL_TURN_RAD;
  } else {
    while (sweepRad <= 0) sweepRad += FULL_TURN_RAD;
  }
  return sweepRad;
}

function linePoints(start: Vec2, end: Vec2): Vec2[] {
  if (distance(start, end) <= AXIS_EPSILON_MM) return [start];
  return [start, end];
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
