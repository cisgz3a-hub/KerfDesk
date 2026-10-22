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
import type { TraceSteps } from '../trace/trace-steps';

// The 100k preparation threshold is routing-only: it moves expensive output
// work to the worker and must not change the geometry that worker compiles.
// Use the largest exactly representable integer so canonical curves never
// fall back to their compatibility polylines merely because they are large.
const COMPILATION_SEGMENT_BUDGET = Number.MAX_SAFE_INTEGER;

export function compilationPolylines(
  path: ColoredPath,
  transform: Transform,
  toleranceMm: number = DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
): ReadonlyArray<Polyline> {
  const flattened = flattenColoredPathCurvesForTransform(path, transform, {
    toleranceMm,
    segmentBudget: COMPILATION_SEGMENT_BUDGET,
  });
  if (flattened.kind !== 'ok') {
    throw new Error('Canonical curve flattening exceeded the JavaScript safe-integer budget.');
  }
  return flattened.polylines;
}

/** compilationPolylines with a checkpoint before each canonical curve, for a
 * trace dense enough that flattening it at once would hold the UI thread.
 * Each curve flattens on its own, exactly as it does inside the whole path:
 * the safe-integer budget is never reached, so it cannot change a flattening. */
export function* compilationPolylinesSteps(
  path: ColoredPath,
  transform: Transform,
  toleranceMm: number = DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
): TraceSteps<ReadonlyArray<Polyline>> {
  const cooperate = yield;
  if (path.curves === undefined) return compilationPolylines(path, transform, toleranceMm);
  const polylines: Polyline[] = [];
  for (const curve of path.curves) {
    if (cooperate) yield;
    // One curve flattens to one polyline.
    polylines.push(...compilationPolylines({ ...path, curves: [curve] }, transform, toleranceMm));
  }
  return polylines;
}
