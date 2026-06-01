import type { PotraceCurve } from './potrace-curve';
import { applyOptimizedBetas, rebuildOptimizedSegments } from './potrace-curve-optimize-rebuild';
import {
  bezier,
  cloneCurve,
  copyPoint,
  cprod,
  ddist,
  dpara,
  interval,
  iprod,
  iprod1,
  mod,
  pointAt,
  segmentAt,
  sign,
  tangent,
  type PointLike,
} from './potrace-curve-optimize-geometry';

export type OptiCandidate = {
  readonly c: readonly [PointLike, PointLike];
  readonly alpha: number;
  readonly t: number;
  readonly s: number;
  readonly pen: number;
};

export type OptiContext = {
  readonly curve: PotraceCurve;
  readonly vertices: readonly PointLike[];
  readonly convexity: readonly number[];
  readonly areaCache: readonly number[];
  readonly tolerance: number;
};

type OptiWindow = {
  readonly first: number;
  readonly baseDistance: number;
  readonly convexitySign: number;
};

type OptiGeometry = {
  readonly p0: PointLike;
  readonly p1: PointLike;
  readonly p2: PointLike;
  readonly p3: PointLike;
  readonly newP1: PointLike;
  readonly newP2: PointLike;
  readonly alpha: number;
  readonly t: number;
  readonly s: number;
};

export type OptimizationPlan = {
  readonly previous: readonly number[];
  readonly length: readonly number[];
  readonly opt: ReadonlyArray<OptiCandidate | null>;
};

function findOptiWindow(ctx: OptiContext, start: number, end: number): OptiWindow | null {
  const m = ctx.curve.segments.length;
  if (start === end) return null;

  const first = mod(start + 1, m);
  const convexitySign = ctx.convexity[first] ?? 0;
  if (convexitySign === 0) return null;

  const baseDistance = ddist(pointAt(ctx.vertices, start), pointAt(ctx.vertices, first));
  return { first, convexitySign, baseDistance };
}

function hasCompatibleConvexity(
  ctx: OptiContext,
  start: number,
  end: number,
  window: OptiWindow,
): boolean {
  const m = ctx.curve.segments.length;
  for (let k = window.first; k !== end; k = mod(k + 1, m)) {
    const k1 = mod(k + 1, m);
    const k2 = mod(k + 2, m);
    if ((ctx.convexity[k1] ?? 0) !== window.convexitySign) return false;
    if (!hasCompatibleTurn(ctx, start, window, k1, k2)) return false;
  }
  return true;
}

function hasCompatibleTurn(
  ctx: OptiContext,
  start: number,
  window: OptiWindow,
  k1: number,
  k2: number,
): boolean {
  const turn = sign(
    cprod(
      pointAt(ctx.vertices, start),
      pointAt(ctx.vertices, window.first),
      pointAt(ctx.vertices, k1),
      pointAt(ctx.vertices, k2),
    ),
  );
  const edgeLimit =
    window.baseDistance *
    ddist(pointAt(ctx.vertices, k1), pointAt(ctx.vertices, k2)) *
    -0.999847695156;
  return (
    turn === window.convexitySign &&
    iprod1(
      pointAt(ctx.vertices, start),
      pointAt(ctx.vertices, window.first),
      pointAt(ctx.vertices, k1),
      pointAt(ctx.vertices, k2),
    ) >= edgeLimit
  );
}

function buildOptiGeometry(
  ctx: OptiContext,
  start: number,
  end: number,
  first: number,
): OptiGeometry | null {
  const m = ctx.curve.segments.length;
  const p0 = copyPoint(segmentAt(ctx.curve, mod(start, m)).c[2]);
  const p1 = copyPoint(pointAt(ctx.vertices, first));
  const p2 = copyPoint(pointAt(ctx.vertices, mod(end, m)));
  const p3 = copyPoint(segmentAt(ctx.curve, mod(end, m)).c[2]);
  const area = curveArea(ctx, start, end);
  const a1 = dpara(p0, p1, p2);
  const a2 = dpara(p0, p1, p3);
  const a3 = dpara(p0, p2, p3);
  const a4 = a1 + a3 - a2;
  if (a2 === a1) return null;

  const t = a3 / (a3 - a4);
  const s = a2 / (a2 - a1);
  const areaFactor = (a2 * t) / 2;
  if (areaFactor === 0) return null;

  const alpha = 2 - Math.sqrt(4 - area / areaFactor / 0.3);
  if (!Number.isFinite(alpha)) return null;

  return {
    p0,
    p1,
    p2,
    p3,
    newP1: interval(t * alpha, p0, p1),
    newP2: interval(s * alpha, p3, p2),
    alpha,
    t,
    s,
  };
}

function curveArea(ctx: OptiContext, start: number, end: number): number {
  const m = ctx.curve.segments.length;
  const startArea = ctx.areaCache[start] ?? 0;
  const endArea = ctx.areaCache[end] ?? 0;
  const closingArea =
    dpara(
      pointAt(ctx.vertices, 0),
      segmentAt(ctx.curve, start).c[2],
      segmentAt(ctx.curve, end).c[2],
    ) / 2;
  return endArea - startArea - closingArea + (start >= end ? (ctx.areaCache[m] ?? 0) : 0);
}

function vertexEdgePenalty(
  ctx: OptiContext,
  geom: OptiGeometry,
  k: number,
  k1: number,
): number | null {
  const tangentParameter = tangent(
    geom.p0,
    geom.newP1,
    geom.newP2,
    geom.p3,
    pointAt(ctx.vertices, k),
    pointAt(ctx.vertices, k1),
  );
  if (tangentParameter < -0.5) return null;

  const point = bezier(tangentParameter, geom.p0, geom.newP1, geom.newP2, geom.p3);
  const distance = ddist(pointAt(ctx.vertices, k), pointAt(ctx.vertices, k1));
  if (distance === 0) return null;

  const d1 = dpara(pointAt(ctx.vertices, k), pointAt(ctx.vertices, k1), point) / distance;
  if (Math.abs(d1) > ctx.tolerance) return null;
  if (iprod(pointAt(ctx.vertices, k), pointAt(ctx.vertices, k1), point) < 0) return null;
  if (iprod(pointAt(ctx.vertices, k1), pointAt(ctx.vertices, k), point) < 0) return null;
  return d1 * d1;
}

function endpointPenalty(
  ctx: OptiContext,
  geom: OptiGeometry,
  k: number,
  k1: number,
): number | null {
  const tangentParameter = tangent(
    geom.p0,
    geom.newP1,
    geom.newP2,
    geom.p3,
    segmentAt(ctx.curve, k).c[2],
    segmentAt(ctx.curve, k1).c[2],
  );
  if (tangentParameter < -0.5) return null;

  const point = bezier(tangentParameter, geom.p0, geom.newP1, geom.newP2, geom.p3);
  const distance = ddist(segmentAt(ctx.curve, k).c[2], segmentAt(ctx.curve, k1).c[2]);
  if (distance === 0) return null;

  const rawD1 =
    dpara(segmentAt(ctx.curve, k).c[2], segmentAt(ctx.curve, k1).c[2], point) / distance;
  const rawD2 =
    (dpara(segmentAt(ctx.curve, k).c[2], segmentAt(ctx.curve, k1).c[2], pointAt(ctx.vertices, k1)) /
      distance) *
    0.75 *
    segmentAt(ctx.curve, k1).alpha;
  const d1 = rawD2 < 0 ? -rawD1 : rawD1;
  const d2 = rawD2 < 0 ? -rawD2 : rawD2;
  if (d1 < d2 - ctx.tolerance) return null;
  return d1 < d2 ? (d1 - d2) * (d1 - d2) : 0;
}

function totalVertexPenalty(
  ctx: OptiContext,
  geom: OptiGeometry,
  first: number,
  end: number,
): number | null {
  let penalty = 0;
  const m = ctx.curve.segments.length;
  for (let k = first; k !== end; k = mod(k + 1, m)) {
    const edgePenalty = vertexEdgePenalty(ctx, geom, k, mod(k + 1, m));
    if (edgePenalty === null) return null;
    penalty += edgePenalty;
  }
  return penalty;
}

function totalEndpointPenalty(
  ctx: OptiContext,
  geom: OptiGeometry,
  start: number,
  end: number,
): number | null {
  let penalty = 0;
  const m = ctx.curve.segments.length;
  for (let k = start; k !== end; k = mod(k + 1, m)) {
    const edgePenalty = endpointPenalty(ctx, geom, k, mod(k + 1, m));
    if (edgePenalty === null) return null;
    penalty += edgePenalty;
  }
  return penalty;
}

function optiPenalty(ctx: OptiContext, start: number, end: number): OptiCandidate | null {
  const window = findOptiWindow(ctx, start, end);
  if (window === null) return null;
  if (!hasCompatibleConvexity(ctx, start, end, window)) return null;

  const geometry = buildOptiGeometry(ctx, start, end, window.first);
  if (geometry === null) return null;

  const vertexPenalty = totalVertexPenalty(ctx, geometry, window.first, end);
  if (vertexPenalty === null) return null;
  const endpointPenaltyTotal = totalEndpointPenalty(ctx, geometry, start, end);
  if (endpointPenaltyTotal === null) return null;

  return {
    c: [geometry.newP1, geometry.newP2],
    alpha: geometry.alpha,
    t: geometry.t,
    s: geometry.s,
    pen: vertexPenalty + endpointPenaltyTotal,
  };
}

function buildConvexity(curve: PotraceCurve, vertices: readonly PointLike[]): number[] {
  const m = curve.segments.length;
  const convexity = new Array<number>(m).fill(0);
  for (let i = 0; i < m; i += 1) {
    convexity[i] =
      segmentAt(curve, i).tag === 'CURVE'
        ? sign(
            dpara(
              pointAt(vertices, mod(i - 1, m)),
              pointAt(vertices, i),
              pointAt(vertices, mod(i + 1, m)),
            ),
          )
        : 0;
  }
  return convexity;
}

function buildAreaCache(curve: PotraceCurve, vertices: readonly PointLike[]): number[] {
  const m = curve.segments.length;
  const areaCache = new Array<number>(m + 1).fill(0);
  let area = 0;
  const p0 = pointAt(vertices, 0);
  for (let i = 0; i < m; i += 1) {
    area += segmentArea(curve, vertices, p0, i);
    areaCache[i + 1] = area;
  }
  return areaCache;
}

function segmentArea(
  curve: PotraceCurve,
  vertices: readonly PointLike[],
  p0: PointLike,
  index: number,
): number {
  const m = curve.segments.length;
  const next = mod(index + 1, m);
  if (segmentAt(curve, next).tag !== 'CURVE') return 0;

  const alpha = segmentAt(curve, next).alpha;
  const curveArea =
    (0.3 *
      alpha *
      (4 - alpha) *
      dpara(segmentAt(curve, index).c[2], pointAt(vertices, next), segmentAt(curve, next).c[2])) /
    2;
  return curveArea + dpara(p0, segmentAt(curve, index).c[2], segmentAt(curve, next).c[2]) / 2;
}

function buildOptimizationPlan(ctx: OptiContext): OptimizationPlan {
  const m = ctx.curve.segments.length;
  const previous = new Array<number>(m + 1).fill(-1);
  const penalty = new Array<number>(m + 1).fill(0);
  const length = new Array<number>(m + 1).fill(0);
  const opt = new Array<OptiCandidate | null>(m + 1).fill(null);

  for (let j = 1; j <= m; j += 1) {
    previous[j] = j - 1;
    penalty[j] = penalty[j - 1] ?? 0;
    length[j] = (length[j - 1] ?? 0) + 1;
    improvePlanAt(ctx, j, previous, penalty, length, opt);
  }
  return { previous, length, opt };
}

function improvePlanAt(
  ctx: OptiContext,
  j: number,
  previous: number[],
  penalty: number[],
  length: number[],
  opt: Array<OptiCandidate | null>,
): void {
  const m = ctx.curve.segments.length;
  for (let i = j - 2; i >= 0; i -= 1) {
    const candidate = optiPenalty(ctx, i, mod(j, m));
    if (candidate === null) break;
    const candidateLength = (length[i] ?? 0) + 1;
    const candidatePenalty = (penalty[i] ?? 0) + candidate.pen;
    if (isBetterPlan(length[j] ?? 0, penalty[j] ?? 0, candidateLength, candidatePenalty)) {
      previous[j] = i;
      penalty[j] = candidatePenalty;
      length[j] = candidateLength;
      opt[j] = candidate;
    }
  }
}

function isBetterPlan(
  currentLength: number,
  currentPenalty: number,
  nextLength: number,
  nextPenalty: number,
): boolean {
  return (
    currentLength > nextLength || (currentLength === nextLength && currentPenalty > nextPenalty)
  );
}

export function optimizePotraceCurve(curve: PotraceCurve, optTolerance: number): PotraceCurve {
  const tolerance = Math.max(0, optTolerance);
  const m = curve.segments.length;
  if (m < 3 || tolerance <= 0) return cloneCurve(curve);

  const vertices = curve.segments.map((segment) => segment.vertex);
  const ctx: OptiContext = {
    curve,
    vertices,
    tolerance,
    convexity: buildConvexity(curve, vertices),
    areaCache: buildAreaCache(curve, vertices),
  };
  const rebuilt = rebuildOptimizedSegments(ctx, buildOptimizationPlan(ctx));
  if (rebuilt === null) return cloneCurve(curve);
  if (!applyOptimizedBetas(rebuilt.segments, rebuilt.s, rebuilt.t)) return cloneCurve(curve);
  return { segments: rebuilt.segments, alphaCurve: true };
}
