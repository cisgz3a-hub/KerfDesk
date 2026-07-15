import type { Vec2 } from '../../scene';

const CENTRIPETAL_ALPHA = 0.5;
const NEAR_POINT_EPSILON = 1e-9;
const MAX_HANDLE_TO_CHORD_RATIO = 1 / 3;

export type CentripetalCubic = {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
};

/** Materialize the tracer's centripetal Catmull-Rom chain as bounded cubics. */
export function fitCentripetalCubics(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
): CentripetalCubic[] {
  if (points.length < (closed ? 3 : 2)) return [];
  const segmentCount = closed ? points.length : points.length - 1;
  const cubics: CentripetalCubic[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const p1 = pointAt(points, index, closed);
    const p2 = pointAt(points, index + 1, closed);
    const p0 =
      !closed && index === 0 ? extrapolateBefore(p1, p2) : pointAt(points, index - 1, closed);
    const p3 =
      !closed && index + 2 >= points.length
        ? extrapolateAfter(p1, p2)
        : pointAt(points, index + 2, closed);
    const chordLength = distance(p1, p2);
    if (chordLength < NEAR_POINT_EPSILON) continue;
    const maxHandleLength = chordLength * MAX_HANDLE_TO_CHORD_RATIO;
    cubics.push({
      p0: p1,
      p1: addBoundedHandle(p1, startTangent(p0, p1, p2), maxHandleLength),
      p2: addBoundedHandle(p2, negate(endTangent(p1, p2, p3)), maxHandleLength),
      p3: p2,
    });
  }
  return cubics;
}

function startTangent(p0: Vec2, p1: Vec2, p2: Vec2): Vec2 {
  const d01 = knotSpan(p0, p1);
  const d12 = knotSpan(p1, p2);
  if (d01 < NEAR_POINT_EPSILON || d12 < NEAR_POINT_EPSILON) return subtract(p2, p1);
  return scale(
    add(
      subtract(scale(subtract(p1, p0), 1 / d01), scale(subtract(p2, p0), 1 / (d01 + d12))),
      scale(subtract(p2, p1), 1 / d12),
    ),
    d12,
  );
}

function endTangent(p1: Vec2, p2: Vec2, p3: Vec2): Vec2 {
  const d12 = knotSpan(p1, p2);
  const d23 = knotSpan(p2, p3);
  if (d12 < NEAR_POINT_EPSILON || d23 < NEAR_POINT_EPSILON) return subtract(p2, p1);
  return scale(
    add(
      subtract(scale(subtract(p2, p1), 1 / d12), scale(subtract(p3, p1), 1 / (d12 + d23))),
      scale(subtract(p3, p2), 1 / d23),
    ),
    d12,
  );
}

function addBoundedHandle(origin: Vec2, tangent: Vec2, maxLength: number): Vec2 {
  const handle = scale(tangent, 1 / 3);
  const length = Math.hypot(handle.x, handle.y);
  const bounded = length > maxLength ? scale(handle, maxLength / length) : handle;
  return add(origin, bounded);
}

function pointAt(points: ReadonlyArray<Vec2>, index: number, closed: boolean): Vec2 {
  const resolved = closed ? (index + points.length) % points.length : index;
  return points[resolved] as Vec2;
}

function extrapolateBefore(first: Vec2, second: Vec2): Vec2 {
  return { x: first.x * 2 - second.x, y: first.y * 2 - second.y };
}

function extrapolateAfter(previous: Vec2, last: Vec2): Vec2 {
  return { x: last.x * 2 - previous.x, y: last.y * 2 - previous.y };
}

function knotSpan(a: Vec2, b: Vec2): number {
  return Math.pow(distance(a, b), CENTRIPETAL_ALPHA);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function negate(value: Vec2): Vec2 {
  return { x: -value.x, y: -value.y };
}

function scale(value: Vec2, factor: number): Vec2 {
  return { x: value.x * factor, y: value.y * factor };
}
