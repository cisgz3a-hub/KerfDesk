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
// Requests are posted the instant they arrive — never queued or held back —
// because Start and Save are operator actions that must not be delayed. The
// worker thread runs them one at a time on its own event loop.
//
// No watchdog timeout, on purpose: this path only runs for over-budget jobs,
// where a legitimate preparation can take minutes. Terminate is reserved for
// the fatal paths (worker runtime error, postMessage failure); every pending
// caller then rejects and falls back to main-thread preparation.

import { outputVectorPreparationTooComplex } from '../../core/job/preparation-complexity';
import { rasterPreparationTooComplex } from '../../core/job/raster-preparation-complexity';
import { validateOutputScope, type OutputScope, type Project } from '../../core/scene';
import type { StartJobPreparation } from './start-job-readiness';
import type {
  OutputPreparationEnvelope,
  OutputPreparationRequest,
  OutputPreparationResponse,
  OutputPreparationResult,
  SaveOutputPreparationRequest,
  StartOutputPreparationRequest,
} from './output-preparation-protocol';
import type { SaveOutputEmission } from './save-output-emission';
import { projectHasPagedRasterAssets } from '../import/paged-raster-hydration';

export function outputPreparationShouldRunOffThread(
  project: Project,
  outputScope?: OutputScope,
): boolean {
  const scoped = outputScope === undefined ? null : validateOutputScope(project.scene, outputScope);
  if (scoped !== null && !scoped.ok) return false;
  const scene = scoped === null ? project.scene : scoped.scene;
  const scopedProject = scene === project.scene ? project : { ...project, scene };
  return (
    projectHasPagedRasterAssets(scopedProject) ||
    outputVectorPreparationTooComplex(scopedProject) ||
    rasterPreparationTooComplex(scopedProject)
  );
}

export function prepareStartOutputOffThread(
  request: StartOutputPreparationRequest,
): Promise<StartJobPreparation> | null {
  const pending = runWorker(request);
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
): Promise<SaveOutputEmission> | null {
  const pending = runWorker(request);
  if (pending === null) return null;
  return pending.then((response) => {
    if (response.kind !== 'save') throw new Error('Background Save preparation returned no file.');
    return response.result;
  });
}

/** Test seam: drops the shared worker so each test starts from a cold client. */
export function resetOutputPreparationWorkerForTests(): void {
  rejectAllPendingAndRetireWorker(new Error(WORKER_RESET_MESSAGE));
}

type PreparedResponse = Exclude<OutputPreparationResponse, { readonly kind: 'error' }>;

type PendingRequest = {
  readonly resolve: (response: PreparedResponse) => void;
  readonly reject: (error: Error) => void;
};

const WORKER_ERROR_MESSAGE = 'Background output preparation worker errored.';
const WORKER_RESET_MESSAGE = 'Background output preparation worker reset.';

let workerInstance: Worker | null = null;
let nextRequestId = 0;
const pendingByRequestId = new Map<number, PendingRequest>();

function runWorker(request: OutputPreparationRequest): Promise<PreparedResponse> | null {
  const worker = ensureWorker();
  if (worker === null) return null;
  return new Promise<PreparedResponse>((resolve, reject) => {
    nextRequestId += 1;
    const requestId = nextRequestId;
    pendingByRequestId.set(requestId, { resolve, reject });
    const envelope: OutputPreparationEnvelope = { requestId, request };
    try {
      worker.postMessage(envelope);
    } catch (error) {
      // The channel is dead for everyone, not just this caller.
      rejectAllPendingAndRetireWorker(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    workerInstance = new Worker(new URL('./output-preparation-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = handleWorkerMessage;
    workerInstance.onerror = (): void => {
      rejectAllPendingAndRetireWorker(new Error(WORKER_ERROR_MESSAGE));
    };
    return workerInstance;
  } catch {
    return null;
  }
}

function handleWorkerMessage(event: MessageEvent<OutputPreparationResult>): void {
  const { requestId, response } = event.data;
  const pending = pendingByRequestId.get(requestId);
  // No longer pending: the request was already settled by a retired worker.
  // Dropping it keeps a stale program from ever reaching a caller.
  if (pending === undefined) return;
  pendingByRequestId.delete(requestId);
  if (response.kind === 'error') pending.reject(new Error(response.message));
  else pending.resolve(response);
}

function retireWorker(): void {
  if (workerInstance === null) return;
  workerInstance.terminate();
  workerInstance = null;
}

function rejectAllPendingAndRetireWorker(error: Error): void {
  retireWorker();
  const pending = Array.from(pendingByRequestId.values());
  pendingByRequestId.clear();
  for (const request of pending) request.reject(error);
}
