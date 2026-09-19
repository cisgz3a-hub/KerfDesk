import { FillRule, trimCollinearD, unionD, type PathD, type PathsD } from 'clipper2-ts';
import { canonicalizeVectorPaths } from '../geometry/vector-path-canonical';
import {
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
} from '../geometry/vector-path-tools';
import { err, ok, type Result } from '../result';
import {
  flattenColoredPathCurves,
  polylineToCurveSubpath,
  type ColoredPath,
  type Polyline,
} from '../scene';
import type { TextRenderResult } from './text-to-polylines';

// Materialized text welding uses a finer local sampling tolerance than CAM's
// 0.025 mm. It keeps its source font/content editable, but the resulting union
// is polygon geometry: later object scaling also scales this 0.001 mm error.
// Line curves describe that actual result; retaining the old glyph cubics would
// make preview/compilation silently restore the joins that welding removed.
const WELD_TOLERANCE_MM = 0.001;
const WELD_PRECISION_DECIMALS = 6;

/** Resolve each text render batch after bend/path placement, preserving its
 * coordinate frame, counters, operation bindings and native open strokes. */
export function weldTextRender(
  rendered: TextRenderResult,
): Result<TextRenderResult, VectorOpError> {
  const paths: ColoredPath[] = [];
  for (const path of rendered.paths) {
    const welded = weldPath(path);
    if (welded.kind === 'error') return welded;
    paths.push(welded.value);
  }
  return ok(
    paths.every((path, index) => path === rendered.paths[index])
      ? rendered
      : { ...rendered, paths },
  );
}

function weldPath(path: ColoredPath): Result<ColoredPath, VectorOpError> {
  const hasClosed = (path.curves ?? path.polylines).some((contour) => contour.closed);
  if (!hasClosed) return ok(path);
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: WELD_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  if (flattened.kind !== 'ok') {
    return err({
      kind: 'operation-failed',
      message: 'The text outlines could not be represented for welding.',
    });
  }
  const closed = flattened.polylines.filter((polyline) => polyline.closed).map(polylineToPathD);
  const reduced = tryVectorOp(() => {
    const welded = canonicalizeVectorPaths(
      unionD(closed, [], FillRule.NonZero, WELD_PRECISION_DECIMALS),
    );
    return { welded, unchanged: sameBoundaries(closed, welded) };
  });
  if (reduced.kind === 'error') return reduced;
  if (reduced.value.welded.length === 0) {
    return err({
      kind: 'empty-result',
      message: 'Welding these text outlines produced no artwork.',
    });
  }
  if (reduced.value.unchanged) return ok(path);
  return ok(replaceClosedContours(path, flattened.polylines, reduced.value.welded));
}

function replaceClosedContours(
  path: ColoredPath,
  flattened: ReadonlyArray<Polyline>,
  welded: PathsD,
): ColoredPath {
  const closed = welded.map(pathDToPolyline);
  const open = flattened.flatMap((polyline, index) => {
    if (polyline.closed) return [];
    const original = path.polylines[index];
    return [original?.closed === false ? original : polyline];
  });
  return {
    ...path,
    polylines: [...closed, ...open],
    ...(path.curves === undefined
      ? {}
      : {
          curves: [
            ...closed.map(polylineToCurveSubpath),
            ...path.curves.filter((curve) => !curve.closed),
          ],
        }),
  };
}

// Only preserve native curves when the union kept every boundary, including
// counters. Comparing normalized rings ignores engine-selected start points,
// direction and removable collinear vertices, but never ignores a changed
// region, a removed contour or a newly introduced intersection.
function sameBoundaries(before: PathsD, after: PathsD): boolean {
  if (before.length !== after.length) return false;
  const left = before.map(boundaryKey).sort();
  const right = after.map(boundaryKey).sort();
  return left.every((key, index) => key === right[index]);
}

function boundaryKey(path: PathD): string {
  const trimmed = trimCollinearD(path, WELD_PRECISION_DECIMALS);
  const forward = JSON.stringify(canonicalizeVectorPaths([trimmed]));
  const backward = JSON.stringify(canonicalizeVectorPaths([[...trimmed].reverse()]));
  return forward < backward ? forward : backward;
}
