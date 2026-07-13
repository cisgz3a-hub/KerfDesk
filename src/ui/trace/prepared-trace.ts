import type { TraceBoundary, TraceOptions } from '../../core/trace';
import type { BoundaryMode } from './region-enhance-trace';
import type { TraceResult } from './use-trace-worker-client';

export type TracePreparationRequest = {
  readonly file: File;
  readonly options: TraceOptions;
  readonly boundary: TraceBoundary | null;
  readonly boundaryMode: BoundaryMode;
};

export type PreparedTrace = {
  readonly request: TracePreparationRequest;
  readonly result: TraceResult;
};

export function matchingPreparedTrace(
  prepared: PreparedTrace | undefined,
  request: TracePreparationRequest,
): TraceResult | undefined {
  if (prepared === undefined) return undefined;
  const prior = prepared.request;
  return prior.file === request.file &&
    prior.options === request.options &&
    prior.boundaryMode === request.boundaryMode &&
    sameBoundary(prior.boundary, request.boundary)
    ? prepared.result
    : undefined;
}

function sameBoundary(a: TraceBoundary | null, b: TraceBoundary | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
