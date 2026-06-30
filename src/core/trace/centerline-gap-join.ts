import type { Polyline, Vec2 } from '../scene';

const GEOMETRY_EPS = 1e-9;
const TANGENT_LOOKAHEAD_PX = 5;
const MIN_ALIGNMENT_SCORE = -0.25;

type EndIndex = 0 | 1;

type JoinCandidate = {
  readonly a: number;
  readonly b: number;
  readonly aEnd: EndIndex;
  readonly bEnd: EndIndex;
  readonly distance: number;
  readonly score: number;
};

export function joinNearbyOpenPolylines(
  polylines: ReadonlyArray<Polyline>,
  maxGapPx: number,
): Polyline[] {
  if (maxGapPx <= 0 || polylines.length <= 1) return [...polylines];
  let working = [...polylines];
  while (true) {
    const candidate = bestJoinCandidate(working, maxGapPx);
    if (candidate === null) break;
    working = mergeCandidate(working, candidate);
  }
  return working.map((polyline) => closeIfGapIsSmall(polyline, maxGapPx));
}

function bestJoinCandidate(
  polylines: ReadonlyArray<Polyline>,
  maxGapPx: number,
): JoinCandidate | null {
  let best: JoinCandidate | null = null;
  for (let a = 0; a < polylines.length; a += 1) {
    for (let b = a + 1; b < polylines.length; b += 1) {
      for (const aEnd of [0, 1] as const) {
        for (const bEnd of [0, 1] as const) {
          const candidate = joinCandidate(polylines, a, b, aEnd, bEnd, maxGapPx);
          if (candidate === null) continue;
          if (best === null || isBetterJoin(candidate, best)) best = candidate;
        }
      }
    }
  }
  return best;
}

function joinCandidate(
  polylines: ReadonlyArray<Polyline>,
  a: number,
  b: number,
  aEnd: EndIndex,
  bEnd: EndIndex,
  maxGapPx: number,
): JoinCandidate | null {
  const aPoint = endpoint(polylines[a], aEnd);
  const bPoint = endpoint(polylines[b], bEnd);
  if (aPoint === null || bPoint === null) return null;
  const gap = distance(aPoint, bPoint);
  if (gap <= GEOMETRY_EPS || gap > maxGapPx) return null;
  const bridge = normalize(subtract(bPoint, aPoint));
  const aAlignment = dot(endpointTangent(polylines[a], aEnd), bridge);
  const bAlignment = dot(endpointTangent(polylines[b], bEnd), scale(bridge, -1));
  const score = aAlignment + bAlignment;
  if (score < MIN_ALIGNMENT_SCORE) return null;
  return { a, b, aEnd, bEnd, distance: gap, score };
}

function isBetterJoin(candidate: JoinCandidate, best: JoinCandidate): boolean {
  if (candidate.distance < best.distance - GEOMETRY_EPS) return true;
  if (Math.abs(candidate.distance - best.distance) <= GEOMETRY_EPS) {
    return candidate.score > best.score;
  }
  return false;
}

function mergeCandidate(polylines: ReadonlyArray<Polyline>, candidate: JoinCandidate): Polyline[] {
  const out: Polyline[] = [];
  const merged = mergePolylines(
    polylines[candidate.a],
    candidate.aEnd,
    polylines[candidate.b],
    candidate.bEnd,
  );
  for (let index = 0; index < polylines.length; index += 1) {
    if (index === candidate.a) out.push(merged);
    else if (index !== candidate.b) {
      const polyline = polylines[index];
      if (polyline !== undefined) out.push(polyline);
    }
  }
  return out;
}

function mergePolylines(
  a: Polyline | undefined,
  aEnd: EndIndex,
  b: Polyline | undefined,
  bEnd: EndIndex,
): Polyline {
  const left = orientedPoints(a?.points ?? [], aEnd === 1);
  const right = orientedPoints(b?.points ?? [], bEnd === 0);
  return { closed: false, points: appendUnique(left, right) };
}

function closeIfGapIsSmall(polyline: Polyline, maxGapPx: number): Polyline {
  if (polyline.closed || polyline.points.length < 3) return polyline;
  const start = polyline.points[0];
  const end = polyline.points[polyline.points.length - 1];
  if (start === undefined || end === undefined) return polyline;
  if (distance(start, end) > maxGapPx) return polyline;
  return { closed: true, points: appendUnique(polyline.points, [start]) };
}

function endpoint(polyline: Polyline | undefined, end: EndIndex): Vec2 | null {
  const points = polyline?.points;
  if (points === undefined || points.length === 0) return null;
  const point = end === 0 ? points[0] : points[points.length - 1];
  return point ?? null;
}

function endpointTangent(polyline: Polyline | undefined, end: EndIndex): Vec2 {
  const points = polyline?.points ?? [];
  if (points.length < 2) return { x: 0, y: 0 };
  if (end === 0) {
    const first = points[0];
    return first === undefined
      ? { x: 0, y: 0 }
      : normalize(subtract(first, pointAfterDistance(points, 0, TANGENT_LOOKAHEAD_PX)));
  }
  const lastIndex = points.length - 1;
  const last = points[lastIndex];
  if (last === undefined) return { x: 0, y: 0 };
  return normalize(subtract(last, pointBeforeDistance(points, lastIndex, TANGENT_LOOKAHEAD_PX)));
}

function pointAfterDistance(points: ReadonlyArray<Vec2>, start: number, target: number): Vec2 {
  let total = 0;
  for (let index = start; index + 1 < points.length; index += 1) {
    const curr = points[index];
    const next = points[index + 1];
    if (curr === undefined || next === undefined) continue;
    total += distance(curr, next);
    if (total >= target) return next;
  }
  return points[points.length - 1] ?? points[start] ?? { x: 0, y: 0 };
}

function pointBeforeDistance(points: ReadonlyArray<Vec2>, start: number, target: number): Vec2 {
  let total = 0;
  for (let index = start; index > 0; index -= 1) {
    const curr = points[index];
    const prev = points[index - 1];
    if (curr === undefined || prev === undefined) continue;
    total += distance(curr, prev);
    if (total >= target) return prev;
  }
  return points[0] ?? points[start] ?? { x: 0, y: 0 };
}

function orientedPoints(points: ReadonlyArray<Vec2>, keepForward: boolean): Vec2[] {
  return keepForward ? [...points] : [...points].reverse();
}

function appendUnique(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): Vec2[] {
  const out = [...a];
  for (const point of b) {
    const prev = out[out.length - 1];
    if (prev === undefined || distance(prev, point) > GEOMETRY_EPS) out.push(point);
  }
  return out;
}

function normalize(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.y);
  return length <= GEOMETRY_EPS ? { x: 0, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(vector: Vec2, factor: number): Vec2 {
  return { x: vector.x * factor, y: vector.y * factor };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
