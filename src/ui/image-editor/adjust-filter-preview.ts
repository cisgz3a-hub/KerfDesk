// Neighbourhood-filter previews off the UI thread (ADR-245 Amendment 2).
//
// Gaussian Blur, Unsharp Mask, High Pass, Median and the two screens are
// defined in document pixels, so their preview filters the whole active
// layer: seconds at 12 MP. On a large document that work goes to a worker
// and the dialog shows a progress bar with Cancel at once. Slider steps that
// arrive closer together than START_DELAY_MS start one render, for the last;
// a step with other settings stops the running render immediately.

import type { RgbaBuffer } from '../../core/image-edit';
import {
  selectionBounds,
  type AdjustRequest,
  type PreviewWindow,
} from './adjust-preview-window';
import {
  cancelFilterPreview,
  filterPreviewWorkerAvailable,
  runFilterPreview,
  runningFilterKey,
  type FilterPreviewJob,
} from './adjust-filter-worker-client';
import { adjustmentById } from './editor-adjustments';
import type { EditorSession } from './editor-session';

/**
 * Below this many pixels a filter step stays on the UI thread: Gaussian Blur,
 * the slowest at its default, takes about 60 ms there at 512 x 512.
 */
export const WORKER_FILTER_MIN_PIXELS = 512 * 512;
export const START_DELAY_MS = 120;

export type FilterPreviewSink = {
  readonly progress: (fraction: number) => void;
  readonly done: (window: RgbaBuffer) => void;
  /** No worker can render this step: preview it on the UI thread instead. */
  readonly fallback: () => void;
};

let startTimer: ReturnType<typeof setTimeout> | null = null;

/** Whether a preview of `id` on `session` renders in the worker. */
export function previewsInWorker(id: AdjustRequest['id'], session: EditorSession): boolean {
  const { width, height } = session.doc;
  return (
    !adjustmentById(id).pointwise &&
    width * height >= WORKER_FILTER_MIN_PIXELS &&
    filterPreviewWorkerAvailable()
  );
}

/** Render `request` over `win` in the worker; the latest call wins. */
export function scheduleFilterPreview(
  session: EditorSession,
  request: AdjustRequest,
  win: PreviewWindow,
  sink: FilterPreviewSink,
): void {
  const job = jobFor(session, request, win);
  clearStartTimer();
  if (runningFilterKey() !== job.key) cancelFilterPreview();
  sink.progress(0);
  startTimer = setTimeout(() => {
    startTimer = null;
    const started = runFilterPreview(job, {
      onProgress: sink.progress,
      onDone: sink.done,
      onError: () => sink.fallback(),
    });
    if (!started) sink.fallback();
  }, START_DELAY_MS);
}

/** Stop any pending or running render (Cancel, Preview off, dialog closed). */
export function stopFilterPreview(): void {
  clearStartTimer();
  cancelFilterPreview();
}

function clearStartTimer(): void {
  if (startTimer !== null) clearTimeout(startTimer);
  startTimer = null;
}

function jobFor(
  session: EditorSession,
  request: AdjustRequest,
  win: PreviewWindow,
): FilterPreviewJob {
  return {
    key: filterKey(session, request),
    adjustment: request,
    win,
    // Copies the worker owns: the session's buffers stay on this thread.
    source: () => ({
      doc: { width: session.doc.width, height: session.doc.height, data: session.doc.data.slice() },
      clip: selectionBounds(session.selection),
      mask:
        session.selection === null
          ? null
          : { ...session.selection, alpha: session.selection.alpha.slice() },
    }),
  };
}

const sessionIds = new WeakMap<EditorSession, number>();
let nextSessionId = 0;

// Same session, revision and settings filter to the same bytes.
function filterKey(session: EditorSession, request: AdjustRequest): string {
  let sessionId = sessionIds.get(session);
  if (sessionId === undefined) {
    nextSessionId += 1;
    sessionId = nextSessionId;
    sessionIds.set(session, sessionId);
  }
  const settings = JSON.stringify([request.id, request.params, request.curvePoints ?? null]);
  return `${sessionId}:${session.revision}:${settings}`;
}
