import {
  type RawImageData,
  type TraceBoundary,
  type TraceOptions,
  cropRawImageData,
  normalizeTraceBoundary,
  offsetBounds,
  offsetColoredPaths,
} from '../../core/trace';
import { traceImageWithFallback, type TraceResult } from './use-trace-worker-client';
import { resolveTraceSourceOptions } from '../../core/trace/trace-alpha';

export async function traceImageRegion(
  image: RawImageData,
  requestedOptions: TraceOptions,
  boundary: TraceBoundary | null | undefined,
  signal?: AbortSignal,
): Promise<TraceResult> {
  const options = resolveTraceSourceOptions(image, requestedOptions);
  const normalized = normalizeTraceBoundary(boundary, image.width, image.height);
  if (normalized === null) {
    return traceImageWithFallback(image, options, signal);
  }
  const cropped = cropRawImageData(image, normalized);
  const traced = await traceImageWithFallback(cropped, options, signal);
  return {
    ...traced,
    paths: offsetColoredPaths(traced.paths, normalized.x, normalized.y),
    bounds: offsetBounds(traced.bounds, normalized.x, normalized.y),
    // The offset paths are back in the full working image's coordinates, not
    // the cropped trace request's local grid.
    width: image.width,
    height: image.height,
  };
}
