// Main-thread client for the large-job preparation worker (ADR-244). When a
// scene is over the ADR-241/ADR-243 responsiveness budgets the canvas
// preview and live estimate pause instead of freezing the UI; this client
// prepares the same project off-thread so both surfaces still fill in,
// seconds-to-minutes later, without blocking a frame.
//
//   - One request per (project identity, options): the preview and estimate
//     consumers share an in-flight preparation via the WeakMap cache.
//   - ONE request is posted to the worker at a time. Further requests for the
//     SAME project are held here until the active compute settles, and a
//     newer same-project request rejects the held (never-started) ones —
//     current-position placement re-keys on every head move, and posting
//     every key would queue unbounded minutes-long computes.
//   - A request for a DIFFERENT project while work is in flight terminates
//     the worker (a compute cannot be interrupted cooperatively) and rejects
//     every stale promise; callers treat rejection as "stale, ignore". The
//     replacement worker spawns immediately so its spawn + module-graph load
//     overlaps the supersede quiet window, and dispatch waits until the
//     window elapses after the LAST supersede so a burst of edits costs one
//     restart (and one structured clone of the Project), not one per edit.
//   - No watchdog timeout on purpose: a 50M-pixel prepare legitimately runs
//     minutes. Staleness is handled by supersede, crashes by onerror.
//   - Environments without Worker (vitest/jsdom) get null: callers keep the
//     paused fallback behavior.

import type { Project } from '../../core/scene';
import type { LargeJobPreparation, LargeJobPreparationOptions } from './large-job-preparation';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';

export type { LargeJobPreparation, LargeJobPreparationOptions } from './large-job-preparation';

// An over-budget prepare legitimately runs minutes; restarting it on every
// edit of a rapid burst means it never finishes (and structured-clones the
// whole Project per edit). After a supersede, dispatch waits out this quiet
// window — re-armed by further supersedes — so a burst costs ONE restart.
export const SUPERSEDE_QUIET_WINDOW_MS = 1500;

const SUPERSEDED_BY_NEWER_PROJECT_MESSAGE = 'superseded by a newer project';
const SUPERSEDED_BY_NEWER_REQUEST_MESSAGE = 'superseded by a newer request';
const WORKER_UNAVAILABLE_MESSAGE = 'preparation worker unavailable';

type QueuedRequest = {
  readonly project: Project;
  readonly options: LargeJobPreparationOptions;
  readonly resolve: (result: LargeJobPreparation) => void;
  readonly reject: (err: Error) => void;
};

type ActiveRequest = QueuedRequest & { readonly id: number };

let workerInstance: Worker | null = null;
let nextRequestId = 0;
let activeRequest: ActiveRequest | null = null;
let queuedRequests: ReadonlyArray<QueuedRequest> = [];
let quietWindowTimer: ReturnType<typeof setTimeout> | null = null;
const settledByProject = new WeakMap<Project, Map<string, Promise<LargeJobPreparation>>>();

/**
 * Prepare a large job off the main thread. Returns null when workers are
 * unavailable; otherwise a promise for the preview toolpath + estimate that
 * rejects if a newer project (or a newer request for the same project)
 * supersedes it.
 */
export function prepareLargeJobOffThread(
  project: Project,
  options: LargeJobPreparationOptions = {},
): Promise<LargeJobPreparation> | null {
  const key = requestKey(options);
  const perProject = cacheFor(project);
  const cached = perProject.get(key);
  if (cached !== undefined) return cached;
  if (hasWorkForOtherProject(project)) {
    supersedeForNewProject();
  } else {
    // Same project, new options key: held requests were superseded by this
    // one. Only the active compute keeps running — stopping it would kill
    // the worker, and its settled result stays cached anyway.
    rejectQueuedRequests(SUPERSEDED_BY_NEWER_REQUEST_MESSAGE);
  }
  if (ensureWorker() === null) return null;
  const promise = new Promise<LargeJobPreparation>((resolve, reject) => {
    queuedRequests = [...queuedRequests, { project, options, resolve, reject }];
  });
  perProject.set(key, promise);
  promise.catch(() => perProject.delete(key));
  dispatchNextRequest();
  return promise;
}

export function resetPreparationWorkerForTests(): void {
  rejectAllPendingAndRetireWorker('preparation worker reset');
}

function requestKey(options: LargeJobPreparationOptions): string {
  return JSON.stringify({
    jobOrigin: options.jobOrigin ?? null,
    outputScope: options.outputScope ?? null,
  });
}

function cacheFor(project: Project): Map<string, Promise<LargeJobPreparation>> {
  const existing = settledByProject.get(project);
  if (existing !== undefined) return existing;
  const created = new Map<string, Promise<LargeJobPreparation>>();
  settledByProject.set(project, created);
  return created;
}

function hasWorkForOtherProject(project: Project): boolean {
  if (activeRequest !== null && activeRequest.project !== project) return true;
  return queuedRequests.some((queued) => queued.project !== project);
}

// The operator moved on to a different scene: everything in flight for the
// old one is stale, and the worker may be mid-compute on it.
function supersedeForNewProject(): void {
  rejectQueuedRequests(SUPERSEDED_BY_NEWER_PROJECT_MESSAGE);
  if (activeRequest !== null) {
    const stale = activeRequest;
    activeRequest = null;
    // Terminating is the only way to stop the mid-compute worker; respawn
    // immediately so the replacement's spawn + module-graph load overlaps
    // the quiet window instead of serializing in front of the next dispatch.
    retireWorker();
    ensureWorker();
    stale.reject(new Error(SUPERSEDED_BY_NEWER_PROJECT_MESSAGE));
  }
  armQuietWindow();
}

function armQuietWindow(): void {
  if (quietWindowTimer !== null) clearTimeout(quietWindowTimer);
  quietWindowTimer = setTimeout(() => {
    quietWindowTimer = null;
    dispatchNextRequest();
  }, SUPERSEDE_QUIET_WINDOW_MS);
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    workerInstance = new Worker(new URL('./preparation-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = handleWorkerMessage;
    workerInstance.onerror = (): void => {
      rejectAllPendingAndRetireWorker('preparation worker errored');
    };
    return workerInstance;
  } catch {
    return null;
  }
}

function handleWorkerMessage(e: MessageEvent<PreparationWorkerResponse>): void {
  if (activeRequest === null || activeRequest.id !== e.data.id) return;
  const settled = activeRequest;
  activeRequest = null;
  if (e.data.kind === 'ok') {
    settled.resolve({ toolpath: e.data.toolpath, estimate: e.data.estimate });
  } else {
    settled.reject(new Error(e.data.message));
  }
  dispatchNextRequest();
}

function dispatchNextRequest(): void {
  if (activeRequest !== null || quietWindowTimer !== null) return;
  const next = queuedRequests[0];
  if (next === undefined) return;
  const worker = ensureWorker();
  if (worker === null) {
    // Worker construction succeeded at request time but fails now (only seen
    // when the environment tears Worker down): nothing can settle these.
    rejectQueuedRequests(WORKER_UNAVAILABLE_MESSAGE);
    return;
  }
  queuedRequests = queuedRequests.slice(1);
  nextRequestId += 1;
  const active: ActiveRequest = { ...next, id: nextRequestId };
  activeRequest = active;
  const request: PreparationWorkerRequest = {
    id: active.id,
    project: active.project,
    ...active.options,
  };
  try {
    worker.postMessage(request);
  } catch (err) {
    activeRequest = null;
    retireWorker();
    active.reject(err instanceof Error ? err : new Error(String(err)));
    rejectQueuedRequests(WORKER_UNAVAILABLE_MESSAGE);
  }
}

function rejectQueuedRequests(message: string): void {
  const stale = queuedRequests;
  queuedRequests = [];
  for (const queued of stale) {
    queued.reject(new Error(message));
  }
}

function rejectAllPendingAndRetireWorker(message: string): void {
  if (quietWindowTimer !== null) {
    clearTimeout(quietWindowTimer);
    quietWindowTimer = null;
  }
  const stale = activeRequest;
  activeRequest = null;
  retireWorker();
  if (stale !== null) stale.reject(new Error(message));
  rejectQueuedRequests(message);
}

function retireWorker(): void {
  if (workerInstance === null) return;
  workerInstance.terminate();
  workerInstance = null;
}
