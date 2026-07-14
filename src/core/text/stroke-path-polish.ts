import { fitCubicsThroughPoints, type CubicBezier } from '../geometry';
import type { CurveSubpath, PathSegment, Vec2 } from '../scene';

export type StrokePathPolishOptions = {
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

/** Fair dense line-only font strokes with the tracer's deterministic cubic fitter. */
export function polishStrokePath(
  path: CurveSubpath,
  options: StrokePathPolishOptions,
): CurveSubpath {
  if (path.segments.some((segment) => segment.kind !== 'line')) return path;
  const points = uniquePoints([path.start, ...path.segments.map((segment) => segment.to)]);
  if (points.length < MIN_FIT_POINTS) return path;
  const corners = collectCorners(points, options);
  const cubics = fitSafeCubics(points, corners, options.fitToleranceUnits);
  if (cubics === null) return path;
  return {
    start: cubics[0]?.p0 ?? path.start,
    closed: false,
    segments: cubics.map(
      (cubic): PathSegment => ({
        kind: 'cubic',
        control1: cubic.p1,
        control2: cubic.p2,
        to: cubic.p3,
      }),
    ),
  };
}

function fitSafeCubics(
  points: ReadonlyArray<Vec2>,
  corners: ReadonlySet<Vec2>,
  tolerance: number,
): ReadonlyArray<CubicBezier> | null {
  const maximumDeviation = tolerance * MAX_DEVIATION_FACTOR;
  for (const scale of FIT_RETRY_SCALES) {
    const cubics = fitCubicsThroughPoints(points, false, corners, tolerance * scale);
    if (cubics.length > 0 && fitStaysNearSource(cubics, points, maximumDeviation)) return cubics;
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
  options: StrokePathPolishOptions,
): ReadonlySet<Vec2> {
  const hardCornerRad = degreesToRadians(options.hardCornerDeg ?? DEFAULT_HARD_CORNER_DEG);
  const continuationRad = degreesToRadians(options.continuationDeg ?? DEFAULT_CONTINUATION_DEG);
  const corners = new Set<Vec2>();
  for (let index = 1; index + 1 < points.length; index += 1) {
    const turn = signedTurn(points, index);
    if (Math.abs(turn) < hardCornerRad) continue;
    if (!hasCurvingContinuation(points, index, turn, continuationRad)) {
      const point = points[index];
      if (point !== undefined) corners.add(point);
    }
  }
  return corners;
}

// A hard vertex whose neighbour keeps turning the same way is a coarse arc,
// matching the tracer's fillet-vs-corner rule. Straight flanks remain pinned.
function hasCurvingContinuation(
  points: ReadonlyArray<Vec2>,
  index: number,
  turn: number,
  continuationRad: number,
): boolean {
  for (const neighbour of [index - 1, index + 1]) {
    const neighbourTurn = signedTurn(points, neighbour);
    if (
      Math.abs(neighbourTurn) >= continuationRad &&
      Math.sign(neighbourTurn) === Math.sign(turn)
    ) {
      return true;
    }
  }
  return false;
}

function signedTurn(points: ReadonlyArray<Vec2>, index: number): number {
  const previous = points[index - 1];
  const current = points[index];
  const next = points[index + 1];
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

function uniquePoints(points: ReadonlyArray<Vec2>): Vec2[] {
  const output: Vec2[] = [];
  for (const point of points) {
    const previous = output.at(-1);
    if (
      previous === undefined ||
      Math.hypot(point.x - previous.x, point.y - previous.y) >= NEAR_POINT_EPS
    ) {
      output.push(point);
    }
  }
  return output;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
