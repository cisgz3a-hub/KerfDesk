import { EndType, FillRule, inflatePathsD, JoinType, unionD } from 'clipper2-ts';

import { collapseTinySegments, MIN_OFFSET_SEGMENT_MM } from '../geometry/collapse-tiny-segments';
import {
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
} from '../geometry/vector-path-tools';
import { ok, type Result } from '../result';
import type { Polyline } from '../scene';

const OFFSET_PRECISION_DECIMALS = 3;
const MIN_CLOSED_POINTS = 3;

/** Resolve the complete cross-object even-odd region before its first inset. */
export function prepareOffsetFillRegion(
  contours: ReadonlyArray<Polyline>,
): Result<ReadonlyArray<Polyline>, VectorOpError> {
  const paths = contours.map(polylineToPathD).filter((path) => path.length >= MIN_CLOSED_POINTS);
  if (paths.length === 0) return ok([]);
  // Follow Shape uses the cross-object even-odd contract (ADR-029). Union
  // resolves overlaps/crossings into consistently wound outers and counters;
  // it does not fill the even-odd overlap as a nonzero union would.
  const prepared = tryVectorOp(() =>
    unionD(paths, [], FillRule.EvenOdd, OFFSET_PRECISION_DECIMALS),
  );
  if (prepared.kind === 'error') return prepared;
  return ok(prepared.value.map((path) => cleanContour(pathDToPolyline(path))));
}

/** Offset an already prepared region, retaining the engine's hole/outer winding. */
export function offsetPreparedFillRegionChecked(
  contours: ReadonlyArray<Polyline>,
  offsetMm: number,
): Result<ReadonlyArray<Polyline>, VectorOpError> {
  if (!Number.isFinite(offsetMm) || offsetMm === 0) return ok(contours);
  // Do not infer containment from a contour's first vertex here. Prepared
  // components can touch, and that inference can turn an outer into a hole
  // depending on its seam, including on later passes of the same fill.
  const offset = tryVectorOp(() =>
    inflatePathsD(
      contours.map(polylineToPathD),
      offsetMm,
      JoinType.Miter,
      EndType.Polygon,
      2,
      OFFSET_PRECISION_DECIMALS,
    ),
  );
  if (offset.kind === 'error') return offset;
  return ok(offset.value.map((path) => cleanContour(pathDToPolyline(path))));
}

function cleanContour(contour: Polyline): Polyline {
  // Keep the existing 5 µm needle cleanup before and between offsets. Its
  // geometric effect is separately tested; raw port paths are not emitted.
  return collapseTinySegments(contour, MIN_OFFSET_SEGMENT_MM);
}
