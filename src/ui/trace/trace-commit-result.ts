import type { TraceBoundary, TraceOptions } from '../../core/trace';
import { loadImageAsRawData } from './image-loader';
import {
  matchingPreparedTrace,
  type PreparedTrace,
  type TracePreparationRequest,
} from './prepared-trace';
import { traceImageWithBoundaryMode, type BoundaryMode } from './region-enhance-trace';
import type { TraceResult } from './use-trace-worker-client';

export async function resolveTraceCommitResult(args: {
  readonly file: File;
  readonly options: TraceOptions;
  readonly boundary?: TraceBoundary | null;
  readonly boundaryMode?: BoundaryMode;
  readonly preparedTrace?: PreparedTrace;
}): Promise<TraceResult> {
  const request: TracePreparationRequest = {
    file: args.file,
    options: args.options,
    boundary: args.boundary ?? null,
    boundaryMode: args.boundaryMode ?? 'crop',
  };
  const prepared = matchingPreparedTrace(args.preparedTrace, request);
  if (prepared !== undefined) return prepared;

  const image = await loadImageAsRawData(args.file);
  return traceImageWithBoundaryMode(
    image,
    args.options,
    args.boundary ?? null,
    args.boundaryMode ?? 'crop',
  );
}
