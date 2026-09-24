import type { TraceBoundary, TraceOptions } from '../../core/trace';
import { loadImageAsRawData } from './image-loader';
import {
  matchingPreparedTrace,
  sameTracePreparationRequest,
  type PendingPreparedTrace,
  type PreparedTrace,
  type TracePreparationRequest,
} from './prepared-trace';
import { traceImageWithBoundaryMode, type BoundaryMode } from './region-enhance-trace';
import type { TraceResult } from './use-trace-worker-client';
import { traceBoundaryForWorkingGrid, type TraceGrid } from './trace-boundary-grid';
import { checkTraceSignal } from './trace-cancellation';
import { rawImageHasTransparency } from './raw-image-transparency';

export async function resolveTraceCommitResult(args: {
  readonly file: File;
  readonly options: TraceOptions;
  readonly boundary?: TraceBoundary | null;
  readonly boundaryMode?: BoundaryMode;
  readonly preparedTrace?: PreparedTrace;
  readonly pendingTrace?: PendingPreparedTrace;
  readonly sourceGrid?: TraceGrid;
  readonly signal?: AbortSignal | undefined;
}): Promise<TraceResult> {
  checkTraceSignal(args.signal);
  const request: TracePreparationRequest = {
    file: args.file,
    options: args.options,
    boundary: args.boundary ?? null,
    boundaryMode: args.boundaryMode ?? 'crop',
    ...(args.sourceGrid === undefined ? {} : { sourceGrid: args.sourceGrid }),
  };
  const prepared = matchingPreparedTrace(args.preparedTrace, request);
  if (prepared !== undefined) return prepared;
  if (
    args.pendingTrace !== undefined &&
    sameTracePreparationRequest(args.pendingTrace.request, request)
  ) {
    return args.pendingTrace.consume(args.signal);
  }

  const image = await loadImageAsRawData(args.file, undefined, args.signal);
  checkTraceSignal(args.signal);
  const sourceHasTransparency = rawImageHasTransparency(image);
  const boundary = traceBoundaryForWorkingGrid(args.boundary, args.sourceGrid, image);
  const result = await traceImageWithBoundaryMode(
    image,
    args.options,
    boundary,
    args.boundaryMode ?? 'crop',
    args.signal,
  );
  return { ...result, sourceHasTransparency };
}
