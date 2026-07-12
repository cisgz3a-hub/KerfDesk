import {
  differenceD,
  EndType,
  FillRule,
  inflatePathsD,
  intersectD,
  JoinType,
  unionD,
  type PathD,
  type PathsD,
} from 'clipper2-ts';
import { tryVectorOp } from '../geometry/vector-path-tools';
import type { Polyline, Vec2 } from '../scene';

export type RestPocketPlan =
  | {
      readonly ok: true;
      readonly toolpaths: ReadonlyArray<Polyline>;
      readonly restRegions: ReadonlyArray<Polyline>;
    }
  | { readonly ok: false; readonly reason: string };

const MIN_POINTS = 3;
const MIN_STEPOVER_PERCENT = 10;
const MAX_STEPOVER_PERCENT = 85;
const MAX_RINGS = 4096;
const PRECISION_DECIMALS = 3;
const EPSILON = 1e-9;

export function planRestPocketToolpaths(
  contours: ReadonlyArray<Polyline>,
  roughToolDiameterMm: number,
  finishToolDiameterMm: number,
  stepoverPercent: number,
): RestPocketPlan {
  const issue = requestIssue(contours, roughToolDiameterMm, finishToolDiameterMm);
  if (issue !== null) return { ok: false, reason: issue };
  const stock = remainingStock(contours, roughToolDiameterMm);
  if (!stock.ok) return stock;
  if (stock.rest.length === 0) return { ok: true, toolpaths: [], restRegions: [] };
  const target = finishTarget(stock.original, stock.rest, finishToolDiameterMm);
  if (target === null) return clipperFailure();
  return {
    ok: true,
    toolpaths: centerRegionRings(target, finishToolDiameterMm, stepoverPercent),
    restRegions: stock.rest.map(toPolyline),
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

function centerRegionRings(
  target: PathsD,
  toolDiameterMm: number,
  stepoverPercent: number,
): ReadonlyArray<Polyline> {
  const stepMm =
    (Math.min(MAX_STEPOVER_PERCENT, Math.max(MIN_STEPOVER_PERCENT, stepoverPercent)) / 100) *
    toolDiameterMm;
  const levels: PathsD[] = [];
  for (let index = 0; index < MAX_RINGS; index += 1) {
    const paths = index === 0 ? target : offset(target, -index * stepMm, JoinType.Miter);
    if (paths === null || paths.length === 0) break;
    levels.push(paths);
  }
  const out: Polyline[] = [];
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const level = levels[index];
    if (level !== undefined) out.push(...level.map(toPolyline));
  }
  return out;
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
