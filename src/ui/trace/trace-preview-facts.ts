// What the trace settings panel reads from the current preview.
//
// The report (the automatic threshold, whether Line Art added pale detail)
// belongs to one detection: it stays while only finishing controls change, so
// the panel does not flicker on every curve tweak, and it is withdrawn as soon
// as anything that decides detection differs from the traced request. The
// preview's pixel grid, which pixel settings count on, is named only when it
// differs from the image's own size.

import { useState } from 'react';
import type { TraceOptions } from '../../core/trace';
import type { TraceReport } from '../../core/trace/trace-steps';
import { sameBoundary, type PreparedTrace, type TracePreparationRequest } from './prepared-trace';
import type { TraceGrid } from './trace-boundary-grid';
import type { TracePreviewState } from './use-trace-preview';

export type TracePreviewFacts = {
  /** Whether the traced source has transparency, once known. */
  readonly sourceHasTransparency: boolean | undefined;
  /** The traced colours, for the Colour layers swatches (ADR-461). */
  readonly previewColours: ReadonlyArray<string> | undefined;
  /** What automatic detection chose, while the settings still detect that way. */
  readonly report?: TraceReport;
  /** The grid the preview traced, when it is not the image's own size. */
  readonly previewGrid?: TraceGrid;
};

/** The settings a detection depends on, as the dialog holds them now. */
export type TraceDetectionRequest = Pick<
  TracePreparationRequest,
  'file' | 'options' | 'boundary' | 'boundaryMode'
>;

export function tracePreviewFacts(preview: TracePreviewState): TracePreviewFacts {
  return {
    sourceHasTransparency:
      preview.kind === 'tracing' || preview.kind === 'ready'
        ? preview.sourceHasTransparency
        : undefined,
    previewColours: preview.kind === 'ready' ? preview.paths.map((path) => path.color) : undefined,
  };
}

/** tracePreviewFacts plus what the latest finished preview found, which a
 * newer preview still tracing does not yet replace. */
export function useTracePreviewFacts(
  preview: TracePreviewState,
  file: File | null,
  options: TraceOptions,
  area: Pick<TraceDetectionRequest, 'boundary' | 'boundaryMode'>,
): TracePreviewFacts {
  const latest = preview.kind === 'ready' ? preview.preparedTrace : undefined;
  const [finished, setFinished] = useState(latest);
  // Adjusting state while rendering: React re-renders at once with it.
  if (latest !== undefined && latest !== finished) setFinished(latest);
  const { boundary, boundaryMode } = area;
  const current = file === null ? null : { file, options, boundary, boundaryMode };
  return { ...tracePreviewFacts(preview), ...finishedTraceFacts(latest ?? finished, current) };
}

export function finishedTraceFacts(
  finished: PreparedTrace | undefined,
  current: TraceDetectionRequest | null,
): Pick<TracePreviewFacts, 'report' | 'previewGrid'> {
  if (finished === undefined || current === null || finished.request.file !== current.file) {
    return {};
  }
  const { request, result } = finished;
  const source = request.sourceGrid;
  const resized =
    source !== undefined && (source.width !== result.width || source.height !== result.height);
  const detected = result.report !== undefined && sameDetection(request, current);
  return {
    ...(resized ? { previewGrid: { width: result.width, height: result.height } } : {}),
    ...(detected ? { report: result.report } : {}),
  };
}

function sameDetection(a: TraceDetectionRequest, b: TraceDetectionRequest): boolean {
  return (
    sameBoundary(a.boundary, b.boundary) &&
    a.boundaryMode === b.boundaryMode &&
    (a.options === b.options || detectionKey(a.options) === detectionKey(b.options))
  );
}

// These act on ink that detection has already chosen, and on no grid choice:
// curve finishing, the traced-shape area filter, Centerline's gap joining and
// Line + fill's stroke width.
const FINISHING_OPTION_KEYS: ReadonlySet<string> = new Set([
  'smoothness',
  'optimize',
  'ignoreLessThanPixels',
  'centerlineJoinGapPx',
  'hybridMaxStrokeWidthPx',
]);

function detectionKey(options: TraceOptions): string {
  const entries = Object.entries(options).filter(
    ([key, value]) => value !== undefined && !FINISHING_OPTION_KEYS.has(key),
  );
  entries.sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify(entries);
}
