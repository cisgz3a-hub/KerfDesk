// Main-thread client for the output preparation worker. Start and Save compile
// the whole core/job + core/preflight + io/gcode graph off-thread when the
// scene is over the ADR-241/ADR-243 responsiveness budgets.
//
// ONE worker is created lazily and reused for the rest of the session. It used
// to be constructed per click and terminated after its single message, so
// every Start and every Save paid a cold worker spawn — and, in Vite dev, a
// full reload of the unbundled preparation module graph.
//
// Reuse is safe for Start's handoff consistency: the request is a complete
// by-value snapshot (project, controller settings, machine epochs, placement,
// scope), prepareStartJob/prepareOutput hold no module-level mutable state,
// and page-backed rasters are re-read from IndexedDB per request. Nothing is
// cached or shared between requests, so a reused worker emits the same bytes a
// freshly spawned one would. Each response is delivered only to the pending
// request whose id it carries; an id that is no longer pending is dropped.
//
// One request enters the outer worker while at most one more is held by this
// client. Region-local tasks then share the bounded, fair subworker pool;
// undispatched tasks stay coordinator-side.
//
// No watchdog timeout, on purpose: this path only runs for over-budget jobs,
// where a legitimate preparation can take minutes. A fatal failure rejects
// every pending caller. Aborting active synchronous outer-worker work retires
// that Worker and dispatches queued work on a fresh one; queued aborts are
// removed without a restart. Costly callers surface a retryable unavailable
// result and never retry compilation on the main thread.

import type { OutputScope, Project } from '../../core/scene';
import type { StartJobPreparation } from './start-job-readiness';
import type {
  OutputPreparationEnvelope,
  OutputPreparationRequest,
  OutputPreparationResponse,
  OutputPreparationResult,
  PrepareOnlyOutputPreparationRequest,
  RdOutputPreparationRequest,
  SaveOutputPreparationRequest,
  StartOutputPreparationRequest,
  TiledOutputPreparationRequest,
} from './output-preparation-protocol';
import type { PreparedOutput } from '../../io/gcode';
import type { SaveOutputEmission } from './save-output-emission';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import type { EmitRdResult } from '../../io/rd';
import type { TiledOutputPreparation } from '../app/tiled-output-preparation';
import { costlyCanvasPreparation } from '../workspace/canvas-preparation-policy';
import {
  connectCanvasCompilationMainBridge,
  retireCanvasCompilationMainBridge,
} from '../workspace/canvas-compilation-main-bridge';

export function outputPreparationShouldRunOffThread(
  project: Project,
  outputScope?: OutputScope,
): boolean {
  return costlyCanvasPreparation(project, outputScope);
}

export function prepareStartOutputOffThread(
  request: StartOutputPreparationRequest,
  onProgress?: (progress: OutputCompilationProgress) => void,
): Promise<StartJobPreparation> | null {
  const pending = runWorker(request, onProgress);
  if (pending === null) return null;
  return pending.then((response) => {
    if (response.kind !== 'start') throw new Error('Background Start preparation returned no job.');
    return response.result;
  });
}

/**
 * Starts Save preparation on the shared worker when Worker support exists.
 * Returns `null` when it does not; otherwise callers must branch on the
 * resolved result's `kind` before writing.
 */
export function prepareSaveOutputOffThread(
  request: SaveOutputPreparationRequest,
  onProgress?: (progress: OutputCompilationProgress) => void,
  signal?: AbortSignal,
): Promise<SaveOutputEmission> | null {
  const pending = runWorker(request, onProgress, signal);
  if (pending === null) return null;
  return pending.then((response) => {
    if (response.kind !== 'save') throw new Error('Background Save preparation returned no file.');
    return response.result;
  });
}

export function prepareOutputOffThread(
  request: PrepareOnlyOutputPreparationRequest,
  onProgress?: (progress: OutputCompilationProgress) => void,
): Promise<{
  readonly prepared: PreparedOutput;
  readonly machineWarnings: ReadonlyArray<string>;
}> | null {
  const pending = runWorker(request, onProgress);
  if (pending === null) return null;
  return pending.then((response) => {
    if (response.kind !== 'prepared') {
      throw new Error('Background preparation returned no prepared output.');
    }
    return { prepared: response.result, machineWarnings: response.machineWarnings };
  });
}

export function prepareRdOutputOffThread(
  request: RdOutputPreparationRequest,
  onProgress?: (progress: OutputCompilationProgress) => void,
): Promise<EmitRdResult> | null {
  const pending = runWorker(request, onProgress);
  if (pending === null) return null;
  return pending.then((response) => {
    if (response.kind !== 'rd') {
      throw new Error('Background Ruida preparation returned no controller file.');
    }
    return response.result;
  });
}

export function prepareTiledOutputOffThread(
  request: TiledOutputPreparationRequest,
  onProgress?: (progress: OutputCompilationProgress) => void,
  signal?: AbortSignal,
): Promise<TiledOutputPreparation> | null {
  const pending = runWorker(request, onProgress, signal);
  if (pending === null) return null;
  return pending.then((response) => {
    if (response.kind !== 'tiles') {
      throw new Error('Background tiled preparation returned no tile files.');
    }
    return response.result;
  });
}

/** Test seam: drops the shared worker so each test starts from a cold client. */
export function resetOutputPreparationWorkerForTests(): void {
  rejectAllPendingAndRetireWorker(new Error(WORKER_RESET_MESSAGE));
}

type PreparedResponse = Exclude<OutputPreparationResponse, { readonly kind: 'error' }>;

type PendingRequest = {
  readonly envelope: OutputPreparationEnvelope;
  readonly resolve: (response: PreparedResponse) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress?: (progress: OutputCompilationProgress) => void;
  readonly detachAbort: (() => void) | null;
};

const WORKER_ERROR_MESSAGE = 'Background output preparation worker errored.';
const WORKER_RESET_MESSAGE = 'Background output preparation worker reset.';
const MAX_QUEUED_REQUESTS = 1;
export const BACKGROUND_OUTPUT_PREPARATION_UNAVAILABLE_MESSAGE =
  'Background compilation is unavailable. Reopen CurveDesk or enable worker support, then try again.';

let workerInstance: Worker | null = null;
let nextRequestId = 0;
const pendingByRequestId = new Map<number, PendingRequest>();
let activeRequestId: number | null = null;
let queuedRequestIds: ReadonlyArray<number> = [];

function runWorker(
  request: OutputPreparationRequest,
  onProgress?: (progress: OutputCompilationProgress) => void,
  signal?: AbortSignal,
): Promise<PreparedResponse> | null {
  if (signal?.aborted === true) return Promise.reject(outputPreparationAbortError());
  const worker = ensureWorker();
  if (worker === null) return null;
  return new Promise<PreparedResponse>((resolve, reject) => {
    nextRequestId += 1;
    const requestId = nextRequestId;
    const envelope: OutputPreparationEnvelope = { kind: 'prepare', requestId, request };
    const abort = (): void => abortRequest(requestId);
    pendingByRequestId.set(requestId, {
      envelope,
      resolve,
      reject,
      ...(onProgress === undefined ? {} : { onProgress }),
      detachAbort: signal === undefined ? null : () => signal.removeEventListener('abort', abort),
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (activeRequestId === null) {
      dispatchRequest(worker, requestId);
    } else if (queuedRequestIds.length < MAX_QUEUED_REQUESTS) {
      queuedRequestIds = [...queuedRequestIds, requestId];
    } else {
      takePending(requestId);
      reject(new Error('Background output preparation queue is full.'));
    }
  });
}

function dispatchRequest(worker: Worker, requestId: number): void {
  const pending = pendingByRequestId.get(requestId);
  if (pending === undefined) return;
  activeRequestId = requestId;
  try {
    worker.postMessage(pending.envelope);
  } catch (error) {
    rejectAllPendingAndRetireWorker(error instanceof Error ? error : new Error(String(error)));
  }
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    const created = new Worker(new URL('./output-preparation-worker.ts', import.meta.url), {
      type: 'module',
    });
    connectCanvasCompilationMainBridge(created);
    created.onmessage = handleWorkerMessage;
    created.onerror = (): void => {
      rejectAllPendingAndRetireWorker(new Error(WORKER_ERROR_MESSAGE));
    };
    created.onmessageerror = (): void => {
      rejectAllPendingAndRetireWorker(
        new Error('Background output preparation response was not cloneable.'),
      );
    };
    workerInstance = created;
    return created;
  } catch {
    return null;
  }
}

function handleWorkerMessage(event: MessageEvent<OutputPreparationResult>): void {
  const { requestId } = event.data;
  const pending = pendingByRequestId.get(requestId);
  // No longer pending: the request was already settled by a retired worker.
  // Dropping it keeps a stale program from ever reaching a caller.
  if (pending === undefined) return;
  if ('progress' in event.data) {
    try {
      pending.onProgress?.(event.data.progress);
    } catch {
      // Progress is observational and cannot settle output preparation.
    }
    return;
  }
  const { response } = event.data;
  takePending(requestId);
  if (activeRequestId === requestId) activeRequestId = null;
  if (response.kind === 'error') pending.reject(new Error(response.message));
  else pending.resolve(response);
  dispatchNextRequest();
}

function abortRequest(requestId: number): void {
  const pending = takePending(requestId);
  if (pending === null) return;
  pending.reject(outputPreparationAbortError());
  if (activeRequestId === requestId) {
    activeRequestId = null;
    // Generic costly phases (pocket/fill/raster/global normalization) are
    // synchronous inside the outer Worker, so a cancel message cannot run
    // until stale work has already finished. Termination is the cancellation
    // boundary: detaching its broker port aborts any assigned planner tasks,
    // and the queued request starts on a fresh outer Worker immediately.
    retireWorker();
    dispatchNextRequest();
    return;
  }
  queuedRequestIds = queuedRequestIds.filter((id) => id !== requestId);
}

function takePending(requestId: number): PendingRequest | null {
  const pending = pendingByRequestId.get(requestId);
  if (pending === undefined) return null;
  pendingByRequestId.delete(requestId);
  pending.detachAbort?.();
  return pending;
}

function dispatchNextRequest(): void {
  if (activeRequestId !== null) return;
  const requestId = queuedRequestIds[0];
  if (requestId === undefined) return;
  queuedRequestIds = queuedRequestIds.slice(1);
  const worker = ensureWorker();
  if (worker === null) {
    rejectAllPendingAndRetireWorker(new Error(WORKER_ERROR_MESSAGE));
    return;
  }
  dispatchRequest(worker, requestId);
}

function retireWorker(): void {
  if (workerInstance === null) return;
  const retired = workerInstance;
  workerInstance = null;
  retireCanvasCompilationMainBridge(retired);
  retired.terminate();
}

function rejectAllPendingAndRetireWorker(error: Error): void {
  retireWorker();
  activeRequestId = null;
  queuedRequestIds = [];
  const pending = Array.from(pendingByRequestId.values());
  pendingByRequestId.clear();
  for (const request of pending) {
    request.detachAbort?.();
    request.reject(error);
  }
}

function outputPreparationAbortError(): Error {
  const error = new Error('Background output preparation cancelled.');
  error.name = 'AbortError';
  return error;
}
