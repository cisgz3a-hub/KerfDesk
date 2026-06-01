import type { Vec2 } from '../scene';

const GEOMETRY_EPS = 1e-9;
const DEFAULT_FIT_TOLERANCE_PX = 1;
const DEFAULT_LINEAR_TOLERANCE_PX = 0.15;
const DEFAULT_CORNER_ANGLE_DEG = 55;
const DEFAULT_SAMPLE_STEP_PX = 3;
const DEFAULT_MAX_DEPTH = 12;
const CORNER_WINDOW_PX = 3;

type CubicBezier = {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
};

export type CenterlineFitOptions = {
  readonly fitTolerancePx?: number;
  readonly linearTolerancePx?: number;
  readonly cornerAngleDeg?: number;
  readonly sampleStepPx?: number;
  readonly maxDepth?: number;
};

type ResolvedCenterlineFitOptions = {
  readonly fitTolerancePx: number;
  readonly linearTolerancePx: number;
  readonly cornerAngleDeg: number;
  readonly sampleStepPx: number;
  readonly maxDepth: number;
};

type FitError = {
  readonly distance: number;
  readonly index: number;
};

export function fitCenterlinePoints(
  points: ReadonlyArray<Vec2>,
  options: CenterlineFitOptions = {},
): Vec2[] {
  const clean = removeDuplicatePoints(points);
  if (clean.length <= 2) return clean;
  const resolved = resolveOptions(options);
  const cornerIndices = findCornerIndices(clean, resolved.cornerAngleDeg);
  const fitted: Vec2[] = [];
  for (let i = 0; i + 1 < cornerIndices.length; i += 1) {
    const start = cornerIndices[i];
    const end = cornerIndices[i + 1];
    if (start === undefined || end === undefined || end <= start) continue;
    appendPoints(fitted, fitSpan(clean.slice(start, end + 1), resolved, 0));
  }
  return fitted.length >= 2 ? fitted : clean;
}

function resolveOptions(options: CenterlineFitOptions): ResolvedCenterlineFitOptions {
  return {
    fitTolerancePx: Math.max(0, options.fitTolerancePx ?? DEFAULT_FIT_TOLERANCE_PX),
    linearTolerancePx: Math.max(0, options.linearTolerancePx ?? DEFAULT_LINEAR_TOLERANCE_PX),
    cornerAngleDeg: Math.max(1, Math.min(179, options.cornerAngleDeg ?? DEFAULT_CORNER_ANGLE_DEG)),
    sampleStepPx: Math.max(0.5, options.sampleStepPx ?? DEFAULT_SAMPLE_STEP_PX),
    maxDepth: Math.max(1, Math.floor(options.maxDepth ?? DEFAULT_MAX_DEPTH)),
  };
}

function fitSpan(
  points: ReadonlyArray<Vec2>,
  options: ResolvedCenterlineFitOptions,
  depth: number,
): Vec2[] {
  if (points.length <= 2 || isLinearEnough(points, options.linearTolerancePx)) {
    return endpoints(points);
  }

  const cubic = generateBezier(points);
  const params = chordLengthParams(points);
  const error = maxFitError(points, params, cubic);
  if (error.distance <= options.fitTolerancePx || depth >= options.maxDepth) {
    if (isCubicLinearEnough(cubic, Math.max(options.linearTolerancePx, options.fitTolerancePx))) {
      return endpoints(points);
    }
    return sampleCubic(cubic, options.sampleStepPx);
  }

  const split = Math.max(1, Math.min(points.length - 2, error.index));
  const left = fitSpan(points.slice(0, split + 1), options, depth + 1);
  const right = fitSpan(points.slice(split), options, depth + 1);
  return joined(left, right);
}

function generateBezier(points: ReadonlyArray<Vec2>): CubicBezier {
  const p0 = points[0];
  const p3 = points[points.length - 1];
  if (p0 === undefined || p3 === undefined) return zeroCubic();
  const t1 = startTangent(points);
  const t2 = endTangent(points);
  const params = chordLengthParams(points);
  const fallbackAlpha = distance(p0, p3) / 3;

  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  // Cubic least-squares fit with fixed endpoints and endpoint tangents:
  // C(u)=B0*P0+B1*(P0+a1*T1)+B2*(P3+a2*T2)+B3*P3.
  // Chord-length u values make the unknowns only the two handle lengths a1/a2.
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const u = params[i];
    if (p === undefined || u === undefined) continue;
    const [b0, b1, b2, b3] = bernstein3(u);
    const a1 = scale(t1, b1);
    const a2 = scale(t2, b2);
    const base = add(scale(p0, b0 + b1), scale(p3, b2 + b3));
    const residual = subtract(p, base);

    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    x0 += dot(a1, residual);
    x1 += dot(a2, residual);
  }

  const det = c00 * c11 - c01 * c01;
  let alpha1 = fallbackAlpha;
  let alpha2 = fallbackAlpha;
  if (Math.abs(det) > GEOMETRY_EPS) {
    alpha1 = (x0 * c11 - x1 * c01) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  }
  if (!Number.isFinite(alpha1) || alpha1 <= GEOMETRY_EPS) alpha1 = fallbackAlpha;
  if (!Number.isFinite(alpha2) || alpha2 <= GEOMETRY_EPS) alpha2 = fallbackAlpha;

  return {
    p0,
    p1: add(p0, scale(t1, alpha1)),
    p2: add(p3, scale(t2, alpha2)),
    p3,
  };
}

function chordLengthParams(points: ReadonlyArray<Vec2>): number[] {
  const params = new Array<number>(points.length).fill(0);
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev === undefined || curr === undefined) continue;
    total += distance(prev, curr);
    params[i] = total;
  }
  if (total <= GEOMETRY_EPS) return params;
  for (let i = 1; i < params.length; i += 1) params[i] = (params[i] ?? 0) / total;
  return params;
}

function bernstein3(t: number): readonly [number, number, number, number] {
  const omt = 1 - t;
  const omt2 = omt * omt;
  const t2 = t * t;
  return [omt2 * omt, 3 * t * omt2, 3 * t2 * omt, t2 * t];
}

function maxFitError(
  points: ReadonlyArray<Vec2>,
  params: ReadonlyArray<number>,
  cubic: CubicBezier,
): FitError {
  let worst = 0;
  let index = Math.floor(points.length / 2);
  for (let i = 1; i + 1 < points.length; i += 1) {
    const p = points[i];
    const u = params[i];
    if (p === undefined || u === undefined) continue;
    const d = distance(p, evaluateCubic(cubic, u));
    if (d >= worst) {
      worst = d;
      index = i;
    }
  }
  return { distance: worst, index };
}

function sampleCubic(cubic: CubicBezier, sampleStepPx: number): Vec2[] {
  const estimate = cubicLengthEstimate(cubic);
  const steps = Math.max(2, Math.ceil(estimate / sampleStepPx));
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i += 1) out.push(evaluateCubic(cubic, i / steps));
  return out;
}

function isCubicLinearEnough(cubic: CubicBezier, tolerance: number): boolean {
  return (
    distancePointToSegment(cubic.p1, cubic.p0, cubic.p3) <= tolerance &&
    distancePointToSegment(cubic.p2, cubic.p0, cubic.p3) <= tolerance
  );
}

function evaluateCubic(cubic: CubicBezier, t: number): Vec2 {
  const [b0, b1, b2, b3] = bernstein3(t);
  return add(
    add(scale(cubic.p0, b0), scale(cubic.p1, b1)),
    add(scale(cubic.p2, b2), scale(cubic.p3, b3)),
  );
}

function cubicLengthEstimate(cubic: CubicBezier): number {
  return distance(cubic.p0, cubic.p1) + distance(cubic.p1, cubic.p2) + distance(cubic.p2, cubic.p3);
}

function isLinearEnough(points: ReadonlyArray<Vec2>, tolerance: number): boolean {
  if (points.length <= 2) return true;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return true;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const p = points[i];
    if (p === undefined) continue;
    if (distancePointToSegment(p, first, last) > tolerance) return false;
  }
  return true;
}

function findCornerIndices(points: ReadonlyArray<Vec2>, cornerAngleDeg: number): number[] {
  const candidates: Array<{ readonly index: number; readonly angle: number }> = [];
  for (let i = 1; i + 1 < points.length; i += 1) {
    const prevIndex = indexBeforeDistance(points, i, CORNER_WINDOW_PX);
    const nextIndex = indexAfterDistance(points, i, CORNER_WINDOW_PX);
    if (prevIndex === i || nextIndex === i) continue;
    const prev = points[prevIndex];
    const curr = points[i];
    const next = points[nextIndex];
    if (prev === undefined || curr === undefined || next === undefined) continue;
    const angle = turnAngleDeg(prev, curr, next);
    if (angle >= cornerAngleDeg) candidates.push({ index: i, angle });
  }
  const indices = [0, ...suppressAdjacentCorners(points, candidates), points.length - 1];
  return removeDuplicateIndices(indices);
}

function suppressAdjacentCorners(
  points: ReadonlyArray<Vec2>,
  candidates: ReadonlyArray<{ readonly index: number; readonly angle: number }>,
): number[] {
  const out: number[] = [];
  let cluster: Array<{ readonly index: number; readonly angle: number }> = [];
  for (const candidate of candidates) {
    const prev = cluster[cluster.length - 1];
    if (
      prev !== undefined &&
      pathDistance(points, prev.index, candidate.index) > CORNER_WINDOW_PX * 2
    ) {
      out.push(bestCorner(cluster).index);
      cluster = [];
    }
    cluster.push(candidate);
  }
  if (cluster.length > 0) out.push(bestCorner(cluster).index);
  return out;
}

function bestCorner(
  candidates: ReadonlyArray<{ readonly index: number; readonly angle: number }>,
): { readonly index: number; readonly angle: number } {
  return candidates.reduce((best, candidate) => (candidate.angle > best.angle ? candidate : best));
}

function pathDistance(points: ReadonlyArray<Vec2>, from: number, to: number): number {
  let total = 0;
  for (let i = Math.max(1, from + 1); i <= to; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev === undefined || curr === undefined) continue;
    total += distance(prev, curr);
  }
  return total;
}

function indexBeforeDistance(points: ReadonlyArray<Vec2>, index: number, target: number): number {
  let total = 0;
  for (let i = index; i > 0; i -= 1) {
    const curr = points[i];
    const prev = points[i - 1];
    if (curr === undefined || prev === undefined) continue;
    total += distance(curr, prev);
    if (total >= target) return i - 1;
  }
  return 0;
}

function indexAfterDistance(points: ReadonlyArray<Vec2>, index: number, target: number): number {
  let total = 0;
  for (let i = index; i + 1 < points.length; i += 1) {
    const curr = points[i];
    const next = points[i + 1];
    if (curr === undefined || next === undefined) continue;
    total += distance(curr, next);
    if (total >= target) return i + 1;
  }
  return points.length - 1;
}

function turnAngleDeg(a: Vec2, b: Vec2, c: Vec2): number {
  const u = normalize(subtract(b, a));
  const v = normalize(subtract(c, b));
  if (length(u) <= GEOMETRY_EPS || length(v) <= GEOMETRY_EPS) return 0;
  const d = Math.max(-1, Math.min(1, dot(u, v)));
  return (Math.acos(d) * 180) / Math.PI;
}

function startTangent(points: ReadonlyArray<Vec2>): Vec2 {
  for (let i = 1; i < points.length; i += 1) {
    const start = points[0];
    const p = points[i];
    if (start === undefined || p === undefined) continue;
    const tangent = normalize(subtract(p, start));
    if (length(tangent) > GEOMETRY_EPS) return tangent;
  }
  return { x: 1, y: 0 };
}

function endTangent(points: ReadonlyArray<Vec2>): Vec2 {
  const end = points[points.length - 1];
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const p = points[i];
    if (end === undefined || p === undefined) continue;
    const tangent = normalize(subtract(p, end));
    if (length(tangent) > GEOMETRY_EPS) return tangent;
  }
  return { x: -1, y: 0 };
}

function endpoints(points: ReadonlyArray<Vec2>): Vec2[] {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined) return [];
  if (last === undefined || samePoint(first, last)) return [first];
  return [first, last];
}

function joined(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): Vec2[] {
  const out = [...a];
  appendPoints(out, b);
  return out;
}

function appendPoints(out: Vec2[], points: ReadonlyArray<Vec2>): void {
  for (const point of points) {
    const prev = out[out.length - 1];
    if (prev === undefined || !samePoint(prev, point)) out.push(point);
  }
}

function removeDuplicatePoints(points: ReadonlyArray<Vec2>): Vec2[] {
  const out: Vec2[] = [];
  appendPoints(out, points);
  return out;
}

function removeDuplicateIndices(indices: ReadonlyArray<number>): number[] {
  const out: number[] = [];
  for (const index of indices) {
    if (out[out.length - 1] !== index) out.push(index);
  }
  return out;
}

function zeroCubic(): CubicBezier {
  const origin = { x: 0, y: 0 };
  return { p0: origin, p1: origin, p2: origin, p3: origin };
}

function distancePointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = subtract(b, a);
  const lenSq = dot(ab, ab);
  if (lenSq <= GEOMETRY_EPS) return distance(p, a);
  const t = Math.max(0, Math.min(1, dot(subtract(p, a), ab) / lenSq));
  return distance(p, add(a, scale(ab, t)));
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return distance(a, b) <= GEOMETRY_EPS;
}

function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return len <= GEOMETRY_EPS ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

function length(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function distance(a: Vec2, b: Vec2): number {
  return length(subtract(a, b));
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k };
}
