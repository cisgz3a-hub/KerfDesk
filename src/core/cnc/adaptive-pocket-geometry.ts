import {
  EndType,
  FillRule,
  inflatePathsD,
  isPositiveD,
  JoinType,
  trimCollinearD,
  unionD,
  type PathD,
  type PathsD,
} from 'clipper2-ts';
import { tryVectorOp } from '../geometry/vector-path-tools';
import type { Polyline, Vec2 } from '../scene';
import { filletClosedCorners } from './adaptive-corner-fillet';

const PRECISION_DECIMALS = 3;
const EPSILON = 1e-9;
export const ADAPTIVE_FINISH_ARC_TOLERANCE_MM = 0.001;

export function canonicalAdaptivePocketPaths(contours: ReadonlyArray<Polyline>): PathsD | null {
  return runClipper(() =>
    unionD(toPaths(contours), [], FillRule.EvenOdd, PRECISION_DECIMALS).map((path) =>
      trimCollinearD(path, PRECISION_DECIMALS),
    ),
  );
}

export function componentRegions(region: PathsD): ReadonlyArray<PathsD> {
  const outers = region.filter((path) => isPositiveD(path));
  const holes = region.filter((path) => !isPositiveD(path));
  return outers.map((outer) => [
    outer,
    ...holes.filter((hole) => {
      const probe = hole[0];
      return probe !== undefined && pointInPath(probe, outer);
    }),
  ]);
}

export function hasNestedContours(contours: ReadonlyArray<Polyline>): boolean {
  return contours.some((contour, index) => {
    const probe = contour.points[0];
    return (
      probe !== undefined &&
      contours.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index && pointInPath(probe, toPaths([candidate])[0] ?? []),
      )
    );
  });
}

export function offsetAdaptivePaths(
  paths: PathsD,
  deltaMm: number,
  arcToleranceMm = 0,
  precisionDecimals = PRECISION_DECIMALS,
): PathsD | null {
  return runClipper(() =>
    inflatePathsD(
      paths,
      deltaMm,
      JoinType.Round,
      EndType.Polygon,
      2,
      precisionDecimals,
      arcToleranceMm,
    ),
  );
}

export function toPolyline(path: PathD): Polyline {
  const points = path.map((point) => ({ x: clean(point.x), y: clean(point.y) }));
  const first = points[0];
  return { closed: true, points: first === undefined ? points : [...points, first] };
}

export function toAdaptivePolyline(path: PathD, cornerRadiusMm: number): Polyline {
  const polyline = toPolyline(path);
  return isPositiveD(path) ? filletClosedCorners(polyline, cornerRadiusMm) : polyline;
}

export function pointInPath(point: Vec2, path: PathD): boolean {
  let inside = false;
  for (let index = 0, previous = path.length - 1; index < path.length; previous = index++) {
    const a = path[index];
    const b = path[previous];
    if (a === undefined || b === undefined || a.y > point.y === b.y > point.y) continue;
    const crossingX = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

export function withoutDuplicateClosure(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  return first !== undefined && last !== undefined && pointsEqual(first, last)
    ? points.slice(0, -1)
    : points;
}

function runClipper(operation: () => PathsD): PathsD | null {
  const result = tryVectorOp(operation);
  return result.kind === 'ok' ? result.value : null;
}

function toPaths(polylines: ReadonlyArray<Polyline>): PathsD {
  return polylines.map((polyline) =>
    withoutDuplicateClosure(polyline.points).map((point) => ({ ...point })),
  );
}

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
}

function clean(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
