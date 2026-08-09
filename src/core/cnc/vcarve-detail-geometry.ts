import type { Vec2 } from '../scene';
import { CNC_COORDINATE_DECIMAL_PLACES, CNC_COORDINATE_QUANTUM_MM } from './cnc-output-precision';

export type BoundarySegment = {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
};

export const EMIT_COORDINATE_QUANTUM_MM = CNC_COORDINATE_QUANTUM_MM;

export function emittedPoint(point: Vec2): Vec2 {
  return {
    x: Math.round(point.x / EMIT_COORDINATE_QUANTUM_MM) * EMIT_COORDINATE_QUANTUM_MM,
    y: Math.round(point.y / EMIT_COORDINATE_QUANTUM_MM) * EMIT_COORDINATE_QUANTUM_MM,
  };
}

export function emitXyKey(point: Vec2): string {
  return `${point.x.toFixed(CNC_COORDINATE_DECIMAL_PLACES)},${point.y.toFixed(
    CNC_COORDINATE_DECIMAL_PLACES,
  )}`;
}

export function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

export function segmentToSegmentDistance(a: Vec2, b: Vec2, segment: BoundarySegment): number {
  const c = { x: segment.ax, y: segment.ay };
  const d = { x: segment.bx, y: segment.by };
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a.x, a.y, segment),
    pointToSegmentDistance(b.x, b.y, segment),
    pointToSegmentDistance(c.x, c.y, { ax: a.x, ay: a.y, bx: b.x, by: b.y }),
    pointToSegmentDistance(d.x, d.y, { ax: a.x, ay: a.y, bx: b.x, by: b.y }),
  );
}

export function pointToSegmentDistance(x: number, y: number, segment: BoundarySegment): number {
  const dx = segment.bx - segment.ax;
  const dy = segment.by - segment.ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((x - segment.ax) * dx + (y - segment.ay) * dy) / lengthSquared));
  return Math.hypot(x - (segment.ax + t * dx), y - (segment.ay + t * dy));
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (abC === 0 && onSegment(a, b, c)) return true;
  if (abD === 0 && onSegment(a, b, d)) return true;
  if (cdA === 0 && onSegment(c, d, a)) return true;
  if (cdB === 0 && onSegment(c, d, b)) return true;
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0;
}

function cross(a: Vec2, b: Vec2, point: Vec2): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function onSegment(a: Vec2, b: Vec2, point: Vec2): boolean {
  return (
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y)
  );
}
