// Main-thread client for adjust-filter-worker.ts (ADR-245 Amendment 2).
//
// One preview runs at a time and the latest step wins. A filter is a single
// synchronous call inside the worker, so it cannot hear a cancel message:
// superseding or cancelling a running preview terminates the worker, which
// stops the stale work at once instead of letting it hold the processor for
// seconds. The worker keeps the document it filtered last, so a pan or zoom
// with unchanged settings only resamples the new window, and one that lands
// while that document is still being filtered waits for it instead.

import type { RgbaBuffer } from '../../core/image-edit';
import { stopWorker } from '../common/stop-worker';
import type { AdjustRequest, PreviewWindow } from './adjust-preview-window';
import type {
  FilterPreviewRequest,
  FilterPreviewResponse,
  FilterPreviewSource,
} from './adjust-filter-worker-protocol';

export type FilterPreviewCallbacks = {
  readonly onProgress: (fraction: number) => void;
  readonly onDone: (window: RgbaBuffer) => void;
  /** The worker could not produce this preview; `broken` = do not use it again. */
  readonly onError: (message: string, broken: boolean) => void;
};

export type FilterPreviewJob = {
  /** Names the source and the settings: equal keys filter to equal bytes. */
  readonly key: string;
  readonly adjustment: AdjustRequest;
  readonly win: PreviewWindow;
  /** Called only when the worker does not already hold `key` filtered. */
  readonly source: () => FilterPreviewSource;
};

type Running = {
  readonly id: number;
  readonly key: string;
  readonly adjustment: AdjustRequest;
  calls: FilterPreviewCallbacks;
  /** A newer window for the same filtered document, resampled once it is done. */
  nextWin: PreviewWindow | null;
};

let worker: Worker | null = null;
let running: Running | null = null;
// The key of the document the live worker filtered last, once that finished.
let heldKey: string | null = null;
let nextId = 0;
let broken = false;

/** False without a Worker constructor (Vitest, SSR) or after the worker failed to run. */
export function filterPreviewWorkerAvailable(): boolean {
  return !broken && typeof Worker !== 'undefined';
}

/** The key of the preview being filtered now, if any. */
export function runningFilterKey(): string | null {
  return running?.key ?? null;
}

/**
 * Start `job`. A running preview of another key is terminated; one of the
 * same key finishes and is then resampled over `job.win`. False when no
 * worker can run it.
 */
export function runFilterPreview(job: FilterPreviewJob, calls: FilterPreviewCallbacks): boolean {
  if (running !== null && running.key === job.key) {
    running.calls = calls;
    running.nextWin = job.win;
    return true;
  }
  if (running !== null) retireFilterPreviewWorker();
  const live = ensureWorker();
  if (live === null) return false;
  const source = heldKey === job.key ? null : job.source();
  post(live, { key: job.key, adjustment: job.adjustment, win: job.win, source }, calls);
  return true;
}

type Post = {
  readonly key: string;
  readonly adjustment: AdjustRequest;
  readonly win: PreviewWindow;
  readonly source: FilterPreviewSource | null;
};

function post(live: Worker, job: Post, calls: FilterPreviewCallbacks): void {
  nextId += 1;
  heldKey = null;
  const { key, adjustment, win, source } = job;
  running = { id: nextId, key, adjustment, calls, nextWin: null };
  const request: FilterPreviewRequest = { id: nextId, adjustment, win, source };
  const transfer: Transferable[] =
    source === null
      ? []
      : [source.doc.data.buffer, ...(source.mask === null ? [] : [source.mask.alpha.buffer])];
  try {
    live.postMessage(request, transfer);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

/** Stop the running preview, if any; an idle worker and what it holds are kept. */
export function cancelFilterPreview(): void {
  if (running !== null) retireFilterPreviewWorker();
}

/** Terminate the worker and forget what it held (dialog closed, or a cancel). */
export function retireFilterPreviewWorker(): void {
  running = null;
  heldKey = null;
  if (worker !== null) stopWorker(worker);
  worker = null;
}

function ensureWorker(): Worker | null {
  if (worker !== null) return worker;
  if (!filterPreviewWorkerAvailable()) return null;
  try {
    const made = new Worker(new URL('./adjust-filter-worker.ts', import.meta.url), {
      type: 'module',
    });
    made.onmessage = handleMessage;
    made.onerror = (): void => fail('The preview worker stopped.');
    made.onmessageerror = (): void => fail('The preview worker reply could not be read.');
    worker = made;
    return made;
  } catch {
    broken = true;
    return null;
  }
}

function handleMessage(event: MessageEvent<FilterPreviewResponse>): void {
  const current = running;
  const response = event.data;
  if (current === null || response.id !== current.id) return;
  if (response.kind === 'progress') {
    current.calls.onProgress(response.fraction);
    return;
  }
  running = null;
  if (response.kind === 'error') {
    current.calls.onError(response.message, false);
    return;
  }
  heldKey = current.key;
  if (current.nextWin !== null && worker !== null) {
    // The view moved while this document was filtered: show the new window.
    const { key, adjustment, nextWin } = current;
    post(worker, { key, adjustment, win: nextWin, source: null }, current.calls);
    return;
  }
  current.calls.onDone(response.window);
}

// The worker or its channel can no longer be trusted: retire it, and let the
// dialog fall back to previewing on the UI thread.
function fail(message: string): void {
  const current = running;
  broken = true;
  retireFilterPreviewWorker();
  current?.calls.onError(message, true);
}

/** Test seam: forget a failure so the next test can use a worker again. */
export function resetFilterPreviewWorkerForTests(): void {
  retireFilterPreviewWorker();
  broken = false;
  nextId = 0;
}
