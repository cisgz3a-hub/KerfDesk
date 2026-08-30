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

// The 100k preparation threshold is routing-only: it moves expensive output
// work to the worker and must not change the geometry that worker compiles.
// Use the largest exactly representable integer so canonical curves never
// fall back to their compatibility polylines merely because they are large.
const COMPILATION_SEGMENT_BUDGET = Number.MAX_SAFE_INTEGER;

export function compilationPolylines(
  path: ColoredPath,
  transform: Transform,
): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurvesForTransform(path, transform, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: COMPILATION_SEGMENT_BUDGET,
  });
  if (flattened.kind !== 'ok') {
    throw new Error('Canonical curve flattening exceeded the JavaScript safe-integer budget.');
  }
  return flattened.polylines;
}
