import type { Polyline, Vec2 } from '../scene';

const EPSILON = 1e-9;

export function filletClosedCorners(polyline: Polyline, radiusMm: number): Polyline {
  const points = withoutDuplicateClosure(polyline.points);
  if (points.length < 3) return polyline;
  const rounded: Vec2[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (previous === undefined || current === undefined || next === undefined) continue;
    rounded.push(...filletCorner(previous, current, next, radiusMm));
  }
  const first = rounded[0];
  return { closed: true, points: first === undefined ? rounded : [...rounded, first] };
}

function filletCorner(previous: Vec2, current: Vec2, next: Vec2, radiusMm: number): Vec2[] {
  const incoming = unitVector(current, previous);
  const outgoing = unitVector(current, next);
  if (incoming === null || outgoing === null) return [current];
  const angle = Math.acos(clamp(incoming.x * outgoing.x + incoming.y * outgoing.y, -1, 1));
  if (angle < 0.01 || Math.PI - angle < 0.01) return [current];
  const previousLength = Math.hypot(previous.x - current.x, previous.y - current.y);
  const nextLength = Math.hypot(next.x - current.x, next.y - current.y);
  const tangentDistance = Math.min(
    radiusMm / Math.tan(angle / 2),
    previousLength * 0.45,
    nextLength * 0.45,
  );
  const effectiveRadius = tangentDistance * Math.tan(angle / 2);
  const bisector = unitVector(
    { x: 0, y: 0 },
    { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y },
  );
  if (bisector === null || effectiveRadius <= EPSILON) return [current];
  const centerDistance = effectiveRadius / Math.sin(angle / 2);
  const center = {
    x: current.x + bisector.x * centerDistance,
    y: current.y + bisector.y * centerDistance,
  };
  const start = {
    x: current.x + incoming.x * tangentDistance,
    y: current.y + incoming.y * tangentDistance,
  };
  const end = {
    x: current.x + outgoing.x * tangentDistance,
    y: current.y + outgoing.y * tangentDistance,
  };
  return sampleCornerArc(start, center, end, previous, current, next, effectiveRadius);
}

function sampleCornerArc(
  start: Vec2,
  center: Vec2,
  end: Vec2,
  previous: Vec2,
  current: Vec2,
  next: Vec2,
  radiusMm: number,
): Vec2[] {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const turn = cross(previous, current, next);
  let sweep = endAngle - startAngle;
  if (turn > 0 && sweep < 0) sweep += 2 * Math.PI;
  if (turn < 0 && sweep > 0) sweep -= 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((Math.abs(sweep) * radiusMm) / 0.25));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = startAngle + (sweep * index) / steps;
    return { x: center.x + Math.cos(angle) * radiusMm, y: center.y + Math.sin(angle) * radiusMm };
  });
}

function unitVector(from: Vec2, to: Vec2): Vec2 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length <= EPSILON ? null : { x: dx / length, y: dy / length };
}

function cross(previous: Vec2, current: Vec2, next: Vec2): number {
  return (
    (current.x - previous.x) * (next.y - current.y) -
    (current.y - previous.y) * (next.x - current.x)
  );
}

function withoutDuplicateClosure(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  return first !== undefined && last !== undefined && pointsEqual(first, last)
    ? points.slice(0, -1)
    : points;
}

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
