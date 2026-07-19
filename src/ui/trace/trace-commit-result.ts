import type { TraceBoundary, TraceOptions } from '../../core/trace';
import { loadImageAsRawData } from './image-loader';
import {
  matchingPreparedTrace,
  type PreparedTrace,
  type TracePreparationRequest,
} from './prepared-trace';
import { traceImageWithBoundaryMode, type BoundaryMode } from './region-enhance-trace';
import type { TraceResult } from './use-trace-worker-client';
import { traceBoundaryForWorkingGrid, type TraceGrid } from './trace-boundary-grid';

export async function resolveTraceCommitResult(args: {
  readonly file: File;
  readonly options: TraceOptions;
  readonly boundary?: TraceBoundary | null;
  readonly boundaryMode?: BoundaryMode;
  readonly preparedTrace?: PreparedTrace;
  readonly sourceGrid?: TraceGrid;
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
  const boundary = traceBoundaryForWorkingGrid(args.boundary, args.sourceGrid, image);
  return traceImageWithBoundaryMode(image, args.options, boundary, args.boundaryMode ?? 'crop');
}
