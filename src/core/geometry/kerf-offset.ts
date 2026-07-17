import { EndType, inflatePathsD, isPositiveD, JoinType, type PathD } from 'clipper2-ts';
import type { Polyline } from '../scene';
import { pointInPolygon } from './point-in-polygon';
import { pathDToPolyline, polylineToPathD, tryVectorOp } from './vector-path-tools';

const OFFSET_PRECISION_DECIMALS = 3;
const MIN_CLOSED_POINTS = 3;

export function offsetClosedPolylinesForKerf(
  polylines: ReadonlyArray<Polyline>,
  kerfOffsetMm: number,
): ReadonlyArray<Polyline> {
  return offsetClosedPolylines(polylines, kerfOffsetMm, JoinType.Miter);
}

export function offsetClosedPolylinesWithRoundJoins(
  polylines: ReadonlyArray<Polyline>,
  offsetMm: number,
): ReadonlyArray<Polyline> {
  return offsetClosedPolylines(polylines, offsetMm, JoinType.Round);
}

function offsetClosedPolylines(
  polylines: ReadonlyArray<Polyline>,
  kerfOffsetMm: number,
  joinType: JoinType,
): ReadonlyArray<Polyline> {
  if (!Number.isFinite(kerfOffsetMm) || kerfOffsetMm === 0) return polylines;
  const paths = polylines.map(polylineToPathD).filter((path) => path.length >= MIN_CLOSED_POINTS);
  if (paths.length === 0) return [];
  const oriented = orientByContainment(paths);
  // clipper2-ts can throw internally on pathological geometry; catch it at the
  // boundary so it never escapes the pure core and aborts a compile/generator
  // run (R6). A failed offset yields no paths — the same empty contract every
  // caller already handles for "no usable contours".
  const inflated = tryVectorOp(() =>
    inflatePathsD(
      [...oriented],
      kerfOffsetMm,
      joinType,
      EndType.Polygon,
      2,
      OFFSET_PRECISION_DECIMALS,
    ),
  );
  return inflated.kind === 'error' ? [] : inflated.value.map(pathDToPolyline);
}

function orientByContainment(paths: ReadonlyArray<PathD>): ReadonlyArray<PathD> {
  return paths.map((path, index) => {
    const depth = containingPathCount(path, paths, index);
    const shouldBePositive = depth % 2 === 1;
    return isPositiveD(path) === shouldBePositive ? path : [...path].reverse();
  });
}

function containingPathCount(path: PathD, paths: ReadonlyArray<PathD>, selfIndex: number): number {
  const probe = path[0];
  if (probe === undefined) return 0;
  let depth = 0;
  for (let i = 0; i < paths.length; i += 1) {
    if (i === selfIndex) continue;
    const candidate = paths[i];
    if (candidate !== undefined && pointInPolygon(probe, candidate)) depth += 1;
  }
  return depth;
}
