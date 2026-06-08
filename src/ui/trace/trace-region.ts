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

export async function traceImageRegion(
  image: RawImageData,
  options: TraceOptions,
  boundary: TraceBoundary | null | undefined,
): Promise<TraceResult> {
  const normalized = normalizeTraceBoundary(boundary, image.width, image.height);
  if (normalized === null) {
    return traceImageWithFallback(image, options);
  }
  const cropped = cropRawImageData(image, normalized);
  const traced = await traceImageWithFallback(cropped, options);
  return {
    paths: offsetColoredPaths(traced.paths, normalized.x, normalized.y),
    bounds: offsetBounds(traced.bounds, normalized.x, normalized.y),
  };
}
