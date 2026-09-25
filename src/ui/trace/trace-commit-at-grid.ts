// Commit-time decode and trace at the grid ADR-401 plans from the physical
// output. The preview-grid path (reusing the preview's result) stays in
// trace-commit-result.ts; this module only takes over when the plan asks for
// a finer grid than the preview traced.

import type { TraceBoundary, TraceOptions } from '../../core/trace';
import type { TracePhase } from '../../core/trace/trace-progress';
import { loadImageAsRawData, readImageNaturalSize } from './image-loader';
import {
  matchingPreparedTrace,
  type PendingPreparedTrace,
  type PreparedTrace,
} from './prepared-trace';
import { traceImageWithBoundaryMode, type BoundaryMode } from './region-enhance-trace';
import { rawImageHasTransparency } from './raw-image-transparency';
import { traceBoundaryForWorkingGrid, type TraceGrid } from './trace-boundary-grid';
import { checkTraceSignal, isTraceAbort } from './trace-cancellation';
import {
  commitGridExceedsPreview,
  planTraceCommitGridFor,
  traceOptionsForCommitGrid,
  type TraceCommitGridContext,
  type TraceCommitGridPlan,
} from './trace-commit-grid';
import { isTraceRequestSuperseded, type TraceResult } from './use-trace-worker-client';

export type { TraceCommitGridContext } from './trace-commit-grid';

/** navigator.deviceMemory (Chromium, Electron), in GB; undefined elsewhere. */
export function browserDeviceMemoryGb(): number | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const reported = (navigator as Navigator & { readonly deviceMemory?: unknown }).deviceMemory;
  return typeof reported === 'number' && Number.isFinite(reported) && reported > 0
    ? reported
    : undefined;
}

/** What a finer commit is doing: decoding the source, then the trace phases. */
export type TraceCommitPhase = 'decoding' | TracePhase;

export type TraceCommitAtGridArgs = {
  readonly file: File;
  readonly options: TraceOptions;
  readonly boundary?: TraceBoundary | null;
  readonly boundaryMode?: BoundaryMode;
  readonly preparedTrace?: PreparedTrace;
  readonly pendingTrace?: PendingPreparedTrace | undefined;
  readonly sourceGrid?: TraceGrid;
  readonly commitGrid?: TraceCommitGridContext | undefined;
  readonly signal?: AbortSignal | undefined;
  // Reported only by the finer attempt: a reused preview trace is immediate.
  readonly progress?: ((phase: TraceCommitPhase) => void) | undefined;
};

/**
 * Trace at the planned commit grid, or return null when that grid is the
 * preview's (the caller then reuses or repeats the preview trace). A failure
 * of the finer attempt other than cancellation falls back to `previewGrid`
 * and says so with a notice.
 */
export async function traceAtCommitGrid(
  args: TraceCommitAtGridArgs,
  previewGrid: (args: TraceCommitAtGridArgs) => Promise<TraceResult>,
): Promise<TraceResult | null> {
  const plan = await planCommitGrid(args);
  if (plan === null || !commitGridExceedsPreview(plan)) return null;
  // A preview settled by an earlier commit may already hold this grid.
  const prepared = matchingPreparedTrace(args.preparedTrace, {
    file: args.file,
    options: args.options,
    boundary: args.boundary ?? null,
    boundaryMode: args.boundaryMode ?? 'crop',
    ...(args.sourceGrid === undefined ? {} : { sourceGrid: args.sourceGrid }),
  });
  if (prepared !== undefined && prepared.width >= plan.grid.width) return prepared;
  try {
    return await traceDecoded(args, plan);
  } catch (error) {
    if (isTraceAbort(error) || isTraceRequestSuperseded(error)) throw error;
    checkTraceSignal(args.signal);
    // The finer grid is an improvement, not a requirement. The attempt has
    // superseded any preview still in flight, so do not wait on that one.
    const fallback = await previewGrid({ ...args, pendingTrace: undefined });
    return { ...fallback, notices: [...(fallback.notices ?? []), 'preview-resolution'] };
  }
}

async function planCommitGrid(args: TraceCommitAtGridArgs): Promise<TraceCommitGridPlan | null> {
  const context = args.commitGrid;
  if (context === undefined || args.options.photoDetail !== undefined) return null;
  let native: { readonly width: number; readonly height: number };
  try {
    native = await readImageNaturalSize(args.file, args.signal);
  } catch (error) {
    if (isTraceAbort(error)) throw error;
    // An unreadable size leaves the preview-grid path to report the decode.
    return null;
  }
  checkTraceSignal(args.signal);
  return planTraceCommitGridFor(native, context, args.options);
}

async function traceDecoded(
  args: TraceCommitAtGridArgs,
  plan: TraceCommitGridPlan,
): Promise<TraceResult> {
  args.progress?.('decoding');
  const image = await loadImageAsRawData(args.file, plan.maxEdge, args.signal);
  checkTraceSignal(args.signal);
  const sourceHasTransparency = rawImageHasTransparency(image);
  const boundary = traceBoundaryForWorkingGrid(args.boundary, args.sourceGrid, image);
  const result = await traceImageWithBoundaryMode(
    image,
    // Convert against the grid actually decoded, in case a browser returned
    // a size other than the one requested.
    traceOptionsForCommitGrid(args.options, { grid: image, preview: plan.preview }),
    boundary,
    args.boundaryMode ?? 'crop',
    args.signal,
    args.progress,
  );
  return { ...result, sourceHasTransparency };
}
