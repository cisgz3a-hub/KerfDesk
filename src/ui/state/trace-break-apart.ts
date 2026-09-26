import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  type CncTabAnchor,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type TracedImage,
} from '../../core/scene';
import { groupSubpathsByOuterShape, subpathCount } from '../../core/geometry/outer-shape-groups';
import { boundsFromColoredPaths } from '../../core/trace/trace-bounds';

// ADR-406: Break Apart on a trace yields one object per outer shape, each
// carrying its own holes. Pieces stay traced images in the same pixel grid
// under the same transform, so their curves, fill rule, operations and burn
// are the original's; only the re-trace link is dropped.

type PieceGeometry = {
  readonly path: ColoredPath;
  readonly pathIndex: number;
  readonly subpathIndices: ReadonlyArray<number>;
};

export function canBreakApartTrace(object: TracedImage): boolean {
  return (
    object.locked !== true &&
    object.paths.reduce((count, path) => count + subpathCount(path), 0) > 1
  );
}

/** One traced image per outer shape, or the empty list when the trace is already one shape. */
export function splitTracedImage(
  object: TracedImage,
  uniqueId: (index: number) => string,
): ReadonlyArray<TracedImage> {
  const pieces = pieceGeometries(object);
  if (pieces.length <= 1) return [];
  // The source raster stays in the scene; pieces no longer re-trace from it.
  const { traceSourceId: _detached, ...detached } = object;
  return pieces.map((piece, index) => ({
    ...detached,
    id: uniqueId(index),
    source: `${object.source}#part-${index + 1}`,
    bounds: boundsFromColoredPaths([piece.path]),
    paths: [piece.path],
    ...(object.cncTabAnchors === undefined
      ? {}
      : { cncTabAnchors: pieceTabAnchors(object.cncTabAnchors, piece) }),
  }));
}

function pieceGeometries(object: TracedImage): ReadonlyArray<PieceGeometry> {
  // Centerline traces are strokes: a closed stroke inside another is a
  // separate mark, not a hole. Edge Detection output is filled closed contours
  // like filled-contours (edge-trace.ts), so its holes group with their outer.
  const strokes = object.traceMode === 'centerline';
  return object.paths.flatMap((path, pathIndex) => {
    const groups = strokes
      ? Array.from({ length: subpathCount(path) }, (_, index) => [index])
      : groupSubpathsByOuterShape(path);
    return groups.map((subpathIndices) => ({
      path: pathSubset(path, subpathIndices),
      pathIndex,
      subpathIndices,
    }));
  });
}

function pathSubset(path: ColoredPath, indices: ReadonlyArray<number>): ColoredPath {
  if (path.curves === undefined) {
    return { ...path, polylines: pick(path.polylines, indices) };
  }
  const curves = pick(path.curves, indices);
  // Keep the committed compatibility view (ADR-391: the chords the laser
  // burns) when it is aligned with the curves; rebuild it otherwise.
  const polylines =
    path.polylines.length === path.curves.length
      ? pick(path.polylines, indices)
      : curves.map(curvePolyline);
  return { ...path, curves, polylines };
}

function pick<T>(items: ReadonlyArray<T>, indices: ReadonlyArray<number>): T[] {
  return indices.flatMap((index) => {
    const item = items[index];
    return item === undefined ? [] : [item];
  });
}

/** A canonical curve's machine-tolerance chords (the Break Apart compatibility view). */
export function curvePolyline(curve: CurveSubpath): Polyline {
  const result = flattenCurveSubpath(curve, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  if (result.kind === 'segment-budget-exceeded') {
    throw new Error('Canonical curve flattening exceeded the JavaScript safe-integer budget.');
  }
  return result.polyline;
}

function pieceTabAnchors(
  anchors: ReadonlyArray<CncTabAnchor>,
  piece: PieceGeometry,
): ReadonlyArray<CncTabAnchor> {
  return anchors.flatMap((anchor) => {
    if (anchor.pathIndex !== piece.pathIndex) return [];
    const polylineIndex = piece.subpathIndices.indexOf(anchor.polylineIndex);
    return polylineIndex < 0 ? [] : [{ ...anchor, pathIndex: 0, polylineIndex }];
  });
}
