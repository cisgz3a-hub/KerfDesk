import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import { fitCubicsThroughPoints, type CubicBezier } from './cubic-fit';

export type CurveFairingOptions = {
  readonly fitToleranceUnits: number;
  readonly hardCornerDeg?: number;
  readonly continuationDeg?: number;
};

const DEFAULT_HARD_CORNER_DEG = 60;
const DEFAULT_CONTINUATION_DEG = 20;
const MIN_FIT_POINTS = 4;
const NEAR_POINT_EPS = 1e-9;
const FIT_SAFETY_SAMPLES = 12;
const MAX_DEVIATION_FACTOR = 4;
const FIT_RETRY_SCALES = [1, 0.5, 0.25] as const;

/** Fair a line-only path with the tracer's deterministic cubic fitter. */
export function fairLineCurvePath(path: CurveSubpath, options: CurveFairingOptions): CurveSubpath {
  if (path.segments.some((segment) => segment.kind !== 'line')) return path;
  const points = sourcePoints(path);
  if (points.length < MIN_FIT_POINTS) return path;
  const corners = collectCorners(points, path.closed, options);
  const cubics = fitSafeCubics(points, path.closed, corners, options.fitToleranceUnits);
  if (cubics === null) return path;
  return {
    start: cubics[0]?.p0 ?? path.start,
    closed: path.closed,
    segments: cubics.map(cubicSegment),
  };
}

function sourcePoints(path: CurveSubpath): Vec2[] {
  const points = uniquePoints([path.start, ...path.segments.map((segment) => segment.to)]);
  if (path.closed && samePoint(points[0], points.at(-1))) points.pop();
  return points;
}

function cubicSegment(cubic: CubicBezier): PathSegment {
  return {
    kind: 'cubic',
    control1: cubic.p1,
    control2: cubic.p2,
    to: cubic.p3,
  };
}

function fitSafeCubics(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  tolerance: number,
): ReadonlyArray<CubicBezier> | null {
  const maximumDeviation = tolerance * MAX_DEVIATION_FACTOR;
  const source = closed && points[0] !== undefined ? [...points, points[0]] : points;
  for (const scale of FIT_RETRY_SCALES) {
    const cubics = fitCubicsThroughPoints(points, closed, corners, tolerance * scale);
    if (cubics.length > 0 && fitStaysNearSource(cubics, source, maximumDeviation)) return cubics;
  }
  return null;
}

function fitStaysNearSource(
  cubics: ReadonlyArray<CubicBezier>,
  source: ReadonlyArray<Vec2>,
  maximumDeviation: number,
): boolean {
  for (const cubic of cubics) {
    for (let sample = 1; sample < FIT_SAFETY_SAMPLES; sample += 1) {
      const point = evaluateCubic(cubic, sample / FIT_SAFETY_SAMPLES);
      if (distanceToPolyline(point, source) > maximumDeviation) return false;
    }
  }
  return true;
}

function distanceToPolyline(point: Vec2, source: ReadonlyArray<Vec2>): number {
  let distance = Infinity;
  for (let index = 1; index < source.length; index += 1) {
    const from = source[index - 1];
    const to = source[index];
    if (from !== undefined && to !== undefined) {
      distance = Math.min(distance, pointSegmentDistance(point, from, to));
    }
  }
  return distance;
}

function pointSegmentDistance(point: Vec2, from: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < NEAR_POINT_EPS * NEAR_POINT_EPS) {
    return Math.hypot(point.x - from.x, point.y - from.y);
  }
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (from.x + projection * dx), point.y - (from.y + projection * dy));
}

function evaluateCubic(cubic: CubicBezier, t: number): Vec2 {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * cubic.p0.x +
      3 * inverse * inverse * t * cubic.p1.x +
      3 * inverse * t * t * cubic.p2.x +
      t ** 3 * cubic.p3.x,
    y:
      inverse ** 3 * cubic.p0.y +
      3 * inverse * inverse * t * cubic.p1.y +
      3 * inverse * t * t * cubic.p2.y +
      t ** 3 * cubic.p3.y,
  };
}

function collectCorners(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  options: CurveFairingOptions,
): ReadonlySet<Vec2> {
  const hardCornerRad = degreesToRadians(options.hardCornerDeg ?? DEFAULT_HARD_CORNER_DEG);
  const continuationRad = degreesToRadians(options.continuationDeg ?? DEFAULT_CONTINUATION_DEG);
  const corners = new Set<Vec2>();
  const first = closed ? 0 : 1;
  const end = closed ? points.length : Math.max(1, points.length - 1);
  for (let index = first; index < end; index += 1) {
    const turn = signedTurn(points, index, closed);
    if (Math.abs(turn) < hardCornerRad) continue;
    if (!hasCurvingContinuation(points, index, turn, continuationRad, closed)) {
      const point = points[index];
      if (point !== undefined) corners.add(point);
    }
  }
  return corners;
}

function hasCurvingContinuation(
  points: ReadonlyArray<Vec2>,
  index: number,
  turn: number,
  continuationRad: number,
  closed: boolean,
): boolean {
  for (const neighbour of [index - 1, index + 1]) {
    const neighbourTurn = signedTurn(points, neighbour, closed);
    if (
      Math.abs(neighbourTurn) >= continuationRad &&
      Math.sign(neighbourTurn) === Math.sign(turn)
    ) {
      return true;
    }
  }
  return false;
}

function signedTurn(points: ReadonlyArray<Vec2>, index: number, closed: boolean): number {
  const previous = pointAt(points, index - 1, closed);
  const current = pointAt(points, index, closed);
  const next = pointAt(points, index + 1, closed);
  if (previous === undefined || current === undefined || next === undefined) return 0;
  const inX = current.x - previous.x;
  const inY = current.y - previous.y;
  const outX = next.x - current.x;
  const outY = next.y - current.y;
  const inLength = Math.hypot(inX, inY);
  const outLength = Math.hypot(outX, outY);
  if (inLength < NEAR_POINT_EPS || outLength < NEAR_POINT_EPS) return 0;
  return Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY);
}

function pointAt(points: ReadonlyArray<Vec2>, index: number, closed: boolean): Vec2 | undefined {
  if (!closed) return points[index];
  const wrapped = (index + points.length) % points.length;
  return points[wrapped];
}

function uniquePoints(points: ReadonlyArray<Vec2>): Vec2[] {
  const output: Vec2[] = [];
  for (const point of points) {
    if (!samePoint(output.at(-1), point)) output.push(point);
  }
  return output;
}

function samePoint(a: Vec2 | undefined, b: Vec2 | undefined): boolean {
  return a !== undefined && b !== undefined && Math.hypot(a.x - b.x, a.y - b.y) < NEAR_POINT_EPS;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
