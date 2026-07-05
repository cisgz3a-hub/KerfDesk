// Boundary-mode dispatch for the Trace dialog's region box.
//
// The dialog's boundary box supports two modes (ADR-113):
//   - 'crop'    — LightBurn-parity Boundary crop: the result contains ONLY
//                 the region's paths. Delegates to traceImageRegion unchanged.
//   - 'enhance' — Region-enhance re-trace: trace the FULL image, re-trace the
//                 boxed region supersampled, and patch that back in so a small
//                 feature the full pass dropped is recovered while the rest of
//                 the trace survives untouched.
//
// The pure merge (crop the region, 2x supersample, margin-ring patch) lives in
// core/trace/region-enhance.ts; this module only wires the worker-backed tracer
// into it and re-derives bounds. Keeping the mode a stringly union (not a
// boolean flag) leaves room for a third mode without a signature churn.

import {
  type RawImageData,
  type TraceBoundary,
  type TraceOptions,
  boundsFromColoredPaths,
  enhanceRegionPaths,
} from '../../core/trace';
import { traceImageRegion } from './trace-region';
import { traceImageWithFallback, type TraceResult } from './use-trace-worker-client';

export type BoundaryMode = 'crop' | 'enhance';

/** Trace `image` honouring the dialog's boundary box and its mode. With no
 *  boundary, or in 'crop' mode, this is the existing crop behaviour. In
 *  'enhance' mode with a boundary, the full-image trace is re-traced inside the
 *  region and patched — the region-enhance re-trace of ADR-113. */
export async function traceImageWithBoundaryMode(
  image: RawImageData,
  options: TraceOptions,
  boundary: TraceBoundary | null | undefined,
  mode: BoundaryMode,
): Promise<TraceResult> {
  if (mode === 'crop' || boundary === null || boundary === undefined) {
    return traceImageRegion(image, options, boundary);
  }
  const full = await traceImageWithFallback(image, options);
  const paths = await enhanceRegionPaths({
    image,
    region: boundary,
    fullTracePaths: full.paths,
    options,
    trace: (img, opts) => traceImageWithFallback(img, opts).then((result) => result.paths),
  });
  return { paths, bounds: boundsFromColoredPaths(paths) };
}
