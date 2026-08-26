// Shared curve flattening for the compile path. Both the line path
// (compile-job) and the fill path (layer-fill) materialize a ColoredPath's
// polylines this way, so it lives outside both to keep them cycle-free.

import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  type ColoredPath,
  type Polyline,
  type Transform,
} from '../scene';
import { flattenColoredPathCurvesForTransform } from '../scene/curve-path';

// Matches the raw-vector budget the preparation gate uses, so flattening here
// cannot exceed what preparation already accepted for the same scene.
const COMPILATION_SEGMENT_BUDGET = 100_000;

export function compilationPolylines(
  path: ColoredPath,
  transform: Transform,
): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurvesForTransform(path, transform, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: COMPILATION_SEGMENT_BUDGET,
  });
  // Normal output reaches this only after the matching pre-emit budget check.
  // Direct pure-core callers retain the compatibility view on over-budget data.
  return flattened.kind === 'ok' ? flattened.polylines : path.polylines;
}
