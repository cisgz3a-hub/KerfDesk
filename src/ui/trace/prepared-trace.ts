import type { TraceBoundary, TraceOptions } from '../../core/trace';
import type { BoundaryMode } from './region-enhance-trace';
import type { TraceResult } from './use-trace-worker-client';
import type { TraceGrid } from './trace-boundary-grid';

export type TracePreparationRequest = {
  readonly file: File;
  readonly options: TraceOptions;
  readonly boundary: TraceBoundary | null;
  readonly boundaryMode: BoundaryMode;
  readonly sourceGrid?: TraceGrid;
};

export type PreparedTrace = {
  readonly request: TracePreparationRequest;
  readonly result: TraceResult;
};

export type PendingPreparedTrace = {
  readonly request: TracePreparationRequest;
  readonly consume: (signal?: AbortSignal) => Promise<TraceResult>;
};

export function matchingPreparedTrace(
  prepared: PreparedTrace | undefined,
  request: TracePreparationRequest,
): TraceResult | undefined {
  if (prepared === undefined) return undefined;
  return sameTracePreparationRequest(prepared.request, request) ? prepared.result : undefined;
}

export function sameTracePreparationRequest(
  prior: TracePreparationRequest,
  request: TracePreparationRequest,
): boolean {
  return (
    prior.file === request.file &&
    prior.options === request.options &&
    prior.boundaryMode === request.boundaryMode &&
    sameBoundary(prior.boundary, request.boundary) &&
    prior.sourceGrid?.width === request.sourceGrid?.width &&
    prior.sourceGrid?.height === request.sourceGrid?.height
  );
}

function sameBoundary(a: TraceBoundary | null, b: TraceBoundary | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
