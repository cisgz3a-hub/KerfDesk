// Shared curve flattening for the compile path. Both the line path
// (compile-job) and the fill path (layer-fill) materialize a ColoredPath's
// polylines this way, so it lives outside both to keep them cycle-free.

import {
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenColoredPathCurves,
  type ColoredPath,
  type Polyline,
} from '../scene';

export function compilationPolylines(path: ColoredPath): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurves(path, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: 100_000,
  });
  // Normal output reaches this only after the matching pre-emit budget check.
  // Direct pure-core callers retain the compatibility view on over-budget data.
  return flattened.kind === 'ok' ? flattened.polylines : path.polylines;
}
