import { EndType, inflatePathsD, isPositiveD, JoinType, type PathD } from 'clipper2-ts';
import { ok, type Result } from '../result';
import type { Polyline } from '../scene';
import { collapseTinySegments, MIN_OFFSET_SEGMENT_MM } from './collapse-tiny-segments';
import { normalizeClosedPolylineTreeEvenOddChecked } from './polygon-difference';
import {
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
} from './vector-path-tools';

const OFFSET_PRECISION_DECIMALS = 3;

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

// Round-join twin of offsetClosedPolylinesForKerfChecked: the v-carve detail
// stage grows a ring by the bit-cone radius (a disc, hence round joins) and
// must not read an engine failure as "everything is covered".
export function offsetClosedPolylinesWithRoundJoinsChecked(
  polylines: ReadonlyArray<Polyline>,
  offsetMm: number,
): Result<ReadonlyArray<Polyline>, VectorOpError> {
  return offsetClosedPolylines(polylines, offsetMm, JoinType.Round);
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
  const topology = normalizeClosedPolylineTreeEvenOddChecked(polylines);
  if (topology.kind === 'error') return topology;
  const oriented = topology.value.map((node) =>
    orientForOffset(polylineToPathD(node.contour), node.isHole),
  );
  if (oriented.length === 0) return ok([]);
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

function orientForOffset(path: PathD, isHole: boolean): PathD {
  // Preserve the historical Clipper offset convention: outer contours are
  // negative and holes positive. Ownership now comes from PolyTree topology,
  // not from an arbitrary first vertex.
  return isPositiveD(path) === isHole ? path : [...path].reverse();
}
