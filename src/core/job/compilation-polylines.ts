// Shared curve flattening for the compile path. Both the line path
// (compile-job) and the fill path (layer-fill) materialize a ColoredPath's
// polylines this way, so it lives outside both to keep them cycle-free.

import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenColoredPathCurves,
  type ColoredPath,
  type Polyline,
} from '../scene';

// Matches the raw-vector budget the preparation gate uses, so flattening here
// cannot exceed what preparation already accepted for the same scene.
const COMPILATION_SEGMENT_BUDGET = 100_000;

export function compilationPolylines(path: ColoredPath): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: COMPILATION_SEGMENT_BUDGET,
  });
  // Normal output reaches this only after the matching pre-emit budget check.
  // Direct pure-core callers retain the compatibility view on over-budget data.
  return flattened.kind === 'ok' ? flattened.polylines : path.polylines;
}
