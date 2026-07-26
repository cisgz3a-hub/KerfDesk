import { EndType, inflatePathsD, isPositiveD, JoinType, type PathD } from 'clipper2-ts';
import { ok, type Result } from '../result';
import type { Polyline } from '../scene';
import { collapseTinySegments, MIN_OFFSET_SEGMENT_MM } from './collapse-tiny-segments';
import { pointInPolygon } from './point-in-polygon';
import {
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
} from './vector-path-tools';

const OFFSET_PRECISION_DECIMALS = 3;
const MIN_CLOSED_POINTS = 3;

export function offsetClosedPolylinesForKerf(
  polylines: ReadonlyArray<Polyline>,
  kerfOffsetMm: number,
): ReadonlyArray<Polyline> {
  return contoursOrEmpty(offsetClosedPolylines(polylines, kerfOffsetMm, JoinType.Miter));
}

// Same offset as offsetClosedPolylinesForKerf, but keeps the failure that
// tryVectorOp already computes instead of flattening it to an empty list. A
// caller that cannot tell "no interior left" apart from "the offset engine
// failed" would silently drop geometry from a job; this lets it report instead.
export function offsetClosedPolylinesForKerfChecked(
  polylines: ReadonlyArray<Polyline>,
  kerfOffsetMm: number,
): Result<ReadonlyArray<Polyline>, VectorOpError> {
  return offsetClosedPolylines(polylines, kerfOffsetMm, JoinType.Miter);
}

export function offsetClosedPolylinesWithRoundJoins(
  polylines: ReadonlyArray<Polyline>,
  offsetMm: number,
): ReadonlyArray<Polyline> {
  return contoursOrEmpty(offsetClosedPolylines(polylines, offsetMm, JoinType.Round));
}

// Preserves the pre-existing contract for callers that have no failure path:
// a failed offset reads as "no usable contours".
function contoursOrEmpty(
  result: Result<ReadonlyArray<Polyline>, VectorOpError>,
): ReadonlyArray<Polyline> {
  return result.kind === 'error' ? [] : result.value;
}

function offsetClosedPolylines(
  polylines: ReadonlyArray<Polyline>,
  kerfOffsetMm: number,
  joinType: JoinType,
): Result<ReadonlyArray<Polyline>, VectorOpError> {
  if (!Number.isFinite(kerfOffsetMm) || kerfOffsetMm === 0) return ok(polylines);
  const paths = polylines.map(polylineToPathD).filter((path) => path.length >= MIN_CLOSED_POINTS);
  if (paths.length === 0) return ok([]);
  const oriented = orientByContainment(paths);
  // clipper2-ts can throw internally on pathological geometry; catch it at the
  // boundary so it never escapes the pure core and aborts a compile/generator
  // run (R6). The error is returned rather than flattened to an empty list, so
  // a caller that needs to tell failure apart from "no interior left" can.
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
  if (inflated.kind === 'error') return inflated;
  // Drop the sub-micron needle vertices Clipper leaves at near-collinear joins,
  // before they reach the emitter as ±1µm reversal moves (collapse-tiny-segments).
  return ok(
    inflated.value.map((path) =>
      collapseTinySegments(pathDToPolyline(path), MIN_OFFSET_SEGMENT_MM),
    ),
  );
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
