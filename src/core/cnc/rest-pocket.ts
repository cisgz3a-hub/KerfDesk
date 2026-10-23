import {
  differenceD,
  EndType,
  FillRule,
  inflatePathsD,
  intersectD,
  isPositiveD,
  JoinType,
  unionD,
  type PathD,
  type PathsD,
} from 'clipper2-ts';
import { pointInPolygon } from '../geometry';
import { differenceClosedPolylinesChecked } from '../geometry/polygon-difference';
import { roundStrokeOutline } from '../geometry/round-stroke-outline';
import { tryVectorOp } from '../geometry/vector-path-tools';
import type { Polyline, Vec2 } from '../scene';

export type RestPocketPlan =
  | {
      readonly ok: true;
      readonly toolpaths: ReadonlyArray<Polyline>;
      readonly restRegions: ReadonlyArray<Polyline>;
      // Why the finishing-bit ladder ended. A normal empty offset means every
      // reachable rest region was cleared. A geometry failure or the fixed
      // pass budget can leave rest stock standing, so callers surface an
      // advisory without changing the emitted paths or gating the job.
      readonly completion: RestPocketCompletion;
      readonly stepoverUsed: boolean;
    }
  | { readonly ok: false; readonly reason: string };

const MIN_POINTS = 3;
const MIN_STEPOVER_PERCENT = 10;
const MAX_RINGS = 4096;
const PRECISION_DECIMALS = 3;
const EPSILON = 1e-9;
// The pocket ladder's core-ring bisection (pocket-paths.ts).
const RING_BISECT_ITERATIONS = 24;
const RING_BISECT_TOLERANCE_MM = 0.01;

export type RestPocketCompletion = 'complete' | 'geometry-failed' | 'pass-limit';

// finishToolDiameterMm places the finishing bit's centres and reach; its rings
// step by a stepover percentage of finishClearingDiameterMm, which defaults to
// the same diameter. A tapered ball nose passes its wall and clearing widths
// (layout-cut-widths.ts, ADR-368 Amendment 2).
export function planRestPocketToolpaths(
  contours: ReadonlyArray<Polyline>,
  roughToolDiameterMm: number,
  finishToolDiameterMm: number,
  stepoverPercent: number,
  finishClearingDiameterMm = finishToolDiameterMm,
): RestPocketPlan {
  const issue = requestIssue(contours, roughToolDiameterMm, finishToolDiameterMm);
  if (issue !== null) return { ok: false, reason: issue };
  const stock = remainingStock(contours, roughToolDiameterMm);
  if (!stock.ok) return stock;
  if (stock.rest.length === 0) {
    return {
      ok: true,
      toolpaths: [],
      restRegions: [],
      completion: 'complete',
      stepoverUsed: false,
    };
  }
  const target = finishTarget(stock.original, stock.rest, finishToolDiameterMm);
  if (target === null) return clipperFailure();
  const clearingMm =
    finishClearingDiameterMm > 0 && finishClearingDiameterMm < finishToolDiameterMm
      ? finishClearingDiameterMm
      : finishToolDiameterMm;
  const rings = centerRegionRings(target, clearingMm, stepoverPercent);
  return {
    ok: true,
    toolpaths: rings.toolpaths,
    restRegions: stock.rest.map(toPolyline),
    completion: rings.completion,
    stepoverUsed: true,
  };
}

/** Explicit residual geometry from actual previous routes; no ideal cutter-reach subtraction. */
export function planRestPocketResidualToolpaths(
  contours: ReadonlyArray<Polyline>,
  residual: ReadonlyArray<Polyline>,
  finishDiameterMm: number,
  stepoverPercent: number,
): RestPocketPlan {
  if (
    !positiveFinite(finishDiameterMm) ||
    !positiveFinite(stepoverPercent) ||
    stepoverPercent > 100
  )
    return {
      ok: false,
      reason: 'Stock-aware rest requires a finite finish diameter and stepover at most 100%.',
    };
  const original = runClipper(() =>
    unionD(toPaths(contours), [], FillRule.EvenOdd, PRECISION_DECIMALS),
  );
  const rest = runClipper(() =>
    unionD(toPaths(residual), [], FillRule.EvenOdd, PRECISION_DECIMALS),
  );
  if (original === null || rest === null) return clipperFailure();
  if (rest.length === 0)
    return {
      ok: true,
      toolpaths: [],
      restRegions: [],
      completion: 'complete',
      stepoverUsed: false,
    };
  const centers = offset(original, -finishDiameterMm / 2, JoinType.Round);
  const reach = offset(rest, finishDiameterMm / 2, JoinType.Round);
  if (centers === null || reach === null) return clipperFailure();
  const target = runClipper(() => intersectD(centers, reach, FillRule.NonZero, PRECISION_DECIMALS));
  if (target === null) return clipperFailure();
  const rings = centerRegionRings(target, finishDiameterMm, stepoverPercent);
  return {
    ok: true,
    toolpaths: rings.toolpaths,
    restRegions: residual,
    completion: rings.completion,
    stepoverUsed: true,
  };
}
type RemainingStock =
  | { readonly ok: true; readonly original: PathsD; readonly rest: PathsD }
  | { readonly ok: false; readonly reason: string };

function remainingStock(
  contours: ReadonlyArray<Polyline>,
  roughToolDiameterMm: number,
): RemainingStock {
  const original = runClipper(() => unionD(toPaths(contours), FillRule.EvenOdd));
  if (original === null || original.length === 0) {
    return { ok: false, reason: 'Rest machining could not build a closed pocket region.' };
  }
  const roughCenters = offset(original, -roughToolDiameterMm / 2, JoinType.Miter);
  if (roughCenters === null || roughCenters.length === 0) {
    return { ok: false, reason: 'The roughing bit does not fit this pocket.' };
  }
  const roughSweep = offset(roughCenters, roughToolDiameterMm / 2, JoinType.Round);
  if (roughSweep === null) return clipperFailure();
  const cutRegion = runClipper(() => intersectD(original, roughSweep, FillRule.NonZero));
  if (cutRegion === null) return clipperFailure();
  const rest = runClipper(() => differenceD(original, cutRegion, FillRule.NonZero));
  return rest === null ? clipperFailure() : { ok: true, original, rest };
}

function finishTarget(original: PathsD, rest: PathsD, finishToolDiameterMm: number): PathsD | null {
  const finishCenters = offset(original, -finishToolDiameterMm / 2, JoinType.Miter);
  const restReach = offset(rest, finishToolDiameterMm / 2, JoinType.Round);
  return finishCenters === null || restReach === null
    ? null
    : runClipper(() => intersectD(finishCenters, restReach, FillRule.NonZero));
}

function requestIssue(
  contours: ReadonlyArray<Polyline>,
  roughToolDiameterMm: number,
  finishToolDiameterMm: number,
): string | null {
  if (!positiveFinite(roughToolDiameterMm) || !positiveFinite(finishToolDiameterMm)) {
    return 'Rest-machining bit diameters must be positive and finite.';
  }
  if (roughToolDiameterMm <= finishToolDiameterMm) {
    return 'The roughing bit must be larger than the finishing bit.';
  }
  return contours.some((contour) => !contour.closed || contour.points.length < MIN_POINTS)
    ? 'Rest machining requires closed pocket contours.'
    : null;
}

type CenterRegionRings = {
  readonly toolpaths: ReadonlyArray<Polyline>;
  readonly completion: RestPocketCompletion;
};

// The rest region's own offset ladder. It works on raw clipper PathsD rather
// than through geometry/kerf-offset, so it cannot use buildOffsetLadder — but
// it draws the same distinction that module exists to draw: a null result is
// clipper FAILING, an empty result is the region running out of interior.
// Conflating them truncates the finishing pass and leaves the very stock rest
// machining exists to remove.
function centerRegionRings(
  target: PathsD,
  toolDiameterMm: number,
  stepoverPercent: number,
): CenterRegionRings {
  const exactStepover =
    Number.isFinite(stepoverPercent) && stepoverPercent > 0
      ? stepoverPercent
      : MIN_STEPOVER_PERCENT;
  const stepMm = (exactStepover / 100) * toolDiameterMm;
  const levels: PathsD[] = [];
  let completion: RestPocketCompletion = 'pass-limit';
  for (let index = 0; index < MAX_RINGS; index += 1) {
    const paths = index === 0 ? target : offset(target, -index * stepMm, JoinType.Miter);
    if (paths === null) {
      completion = 'geometry-failed';
      break;
    }
    if (paths.length === 0) {
      completion = 'complete';
      break;
    }
    levels.push(paths);
  }
  if (levels.length === MAX_RINGS) {
    // Reaching the budget is not proof that stock remains: the next valid
    // inset can be empty exactly at the boundary. Probe once beyond the
    // emitted ladder so only actual remaining interior is incomplete.
    const next = offset(target, -MAX_RINGS * stepMm, JoinType.Miter);
    completion = next === null ? 'geometry-failed' : next.length === 0 ? 'complete' : 'pass-limit';
  }
  const out: Polyline[] = [];
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const level = levels[index];
    if (level !== undefined) out.push(...level.map(toPolyline));
  }
  return withRestCores(
    target,
    { toolpaths: out, completion },
    levels.length * stepMm,
    stepMm,
    toolDiameterMm,
  );
}

// A stepover past half the clearing width can leave the last ring's sweep
// short of the target's middle. Every rest slot wider than the bit but
// narrower than two steps kept a full-depth fin along its middle, and the
// ladder still reported complete (CNC audit v1 F2-P2-2). The pocket ladder's
// fix (pocket-paths.ts coreRing and remainingPocketCores, July audit 1.10)
// applies: each target component gets its deepest ring, found by bisection,
// and any target still outside every ring's sweep is cut along its outline
// first. At stepover <= 50% the last ring's sweep always reaches the middle,
// so the ladder is unchanged (ADR-153 Amendment 1).
function withRestCores(
  target: PathsD,
  ladder: CenterRegionRings,
  emptyInsetMm: number,
  stepMm: number,
  clearingDiameterMm: number,
): CenterRegionRings {
  if (!(stepMm > clearingDiameterMm / 2) || ladder.completion !== 'complete') return ladder;
  const cores = restCores(target, emptyInsetMm, ladder.toolpaths, clearingDiameterMm);
  return cores === null
    ? { ...ladder, completion: 'geometry-failed' }
    : { ...ladder, toolpaths: [...cores, ...ladder.toolpaths] };
}

// Null is a geometry failure.
function restCores(
  target: PathsD,
  emptyInsetMm: number,
  rings: ReadonlyArray<Polyline>,
  clearingDiameterMm: number,
): ReadonlyArray<Polyline> | null {
  const deepest: Polyline[] = [];
  for (const component of targetComponents(target)) {
    const ring = deepestRing(component, emptyInsetMm);
    if (ring === null) return null;
    deepest.push(...ring.map(toPolyline));
  }
  const ringed = [...deepest, ...rings];
  const swept = roundStrokeOutline(ringed, clearingDiameterMm);
  if (swept === null) return null;
  const remaining = differenceClosedPolylinesChecked(target.map(toPolyline), swept);
  return remaining.kind === 'error' ? null : [...remaining.value, ...deepest];
}

// Largest inset in (0, emptyInsetMm) that still offsets to a ring, by the
// same bisection as the pocket ladder's deepestRing.
function deepestRing(component: PathsD, emptyInsetMm: number): PathsD | null {
  let low = 0;
  let high = emptyInsetMm;
  let best: PathsD = [];
  for (let i = 0; i < RING_BISECT_ITERATIONS && high - low > RING_BISECT_TOLERANCE_MM; i += 1) {
    const mid = (low + high) / 2;
    const inset = offset(component, -mid, JoinType.Miter);
    if (inset === null) return null;
    if (inset.length === 0) {
      high = mid;
    } else {
      low = mid;
      best = inset;
    }
  }
  return best;
}

// Each outer path of the target with the holes inside it.
function targetComponents(target: PathsD): ReadonlyArray<PathsD> {
  const outers = target.filter((path) => isPositiveD(path));
  const holes = target.filter((path) => !isPositiveD(path));
  return outers.map((outer) => [
    outer,
    ...holes.filter((hole) => {
      const probe = hole[0];
      return probe !== undefined && pointInPolygon(probe, outer);
    }),
  ]);
}

function offset(paths: PathsD, deltaMm: number, joinType: JoinType): PathsD | null {
  return runClipper(() =>
    inflatePathsD(paths, deltaMm, joinType, EndType.Polygon, 2, PRECISION_DECIMALS),
  );
}

function runClipper(operation: () => PathsD): PathsD | null {
  const result = tryVectorOp(operation);
  return result.kind === 'ok' ? result.value : null;
}

function clipperFailure(): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason: 'Rest-machining geometry could not be calculated safely.' };
}

function toPaths(polylines: ReadonlyArray<Polyline>): PathsD {
  return polylines.map((polyline) => {
    const path: PathD = [];
    for (const point of polyline.points) {
      const previous = path[path.length - 1];
      if (previous === undefined || !pointsEqual(previous, point)) path.push({ ...point });
    }
    if (path.length > 1 && pointsEqual(path[0] as Vec2, path[path.length - 1] as Vec2)) path.pop();
    return path;
  });
}

function toPolyline(path: PathD): Polyline {
  const points = path.map((point) => ({ x: clean(point.x), y: clean(point.y) }));
  const first = points[0];
  const last = points[points.length - 1];
  return {
    closed: true,
    points:
      first !== undefined && last !== undefined && !pointsEqual(first, last)
        ? [...points, first]
        : points,
  };
}

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clean(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
