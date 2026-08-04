// Main-thread client for the large-job preparation worker (ADR-244). When a
// scene is over the ADR-241/ADR-243 responsiveness budgets the canvas
// preview and live estimate pause instead of freezing the UI; this client
// prepares the same project off-thread so both surfaces still fill in,
// seconds-to-minutes later, without blocking a frame.
//
//   - One request per exact (project identity, options): the preview and
//     estimate consumers share in-flight work and up to four recently settled
//     preparations. The global settled-result LRU bounds retained geometry.
//   - ONE request is posted to the worker at a time. Further requests for the
//     SAME project are held here until the active compute settles, and a
//     newer same-project request rejects the held (never-started) ones —
//     current-position placement re-keys on every head move, and posting
//     every key would queue unbounded minutes-long computes.
//   - Both supersedes reject with PreparationSupersededError, NOT a plain
//     Error: superseding is this client's own scheduling decision, so callers
//     must ignore it and keep showing what they had. Only a real failure
//     (worker crash, compile error, unavailable worker) rejects with a plain
//     Error and is allowed to reach the operator as a failure.
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
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import type { LargeJobPreparation, LargeJobPreparationOptions } from './large-job-preparation';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';
import {
  connectCanvasCompilationMainBridge,
  retireCanvasCompilationMainBridge,
} from './canvas-compilation-main-bridge';

export type { LargeJobPreparation, LargeJobPreparationOptions } from './large-job-preparation';

// An over-budget prepare legitimately runs minutes; restarting it on every
// edit of a rapid burst means it never finishes (and structured-clones the
// whole Project per edit). After a supersede, dispatch waits out this quiet
// window — re-armed by further supersedes — so a burst costs ONE restart.
export const SUPERSEDE_QUIET_WINDOW_MS = 1500;

// Exact outer-preparation reuse is intentionally small and global. This is
// not a per-operation planner cache: an immutable Project replacement after
// any edit has a different identity and cannot hit an older entry.
export const MAX_SETTLED_PREPARATIONS = 4;

const WORKER_UNAVAILABLE_MESSAGE = 'preparation worker unavailable';

/** Why this client dropped a request in favour of a newer one. */
export type PreparationSupersedeReason = 'newer-project' | 'newer-request';

const SUPERSEDE_MESSAGES: Record<PreparationSupersedeReason, string> = {
  'newer-project': 'superseded by a newer project',
  'newer-request': 'superseded by a newer request',
};

/**
 * Rejection reason for a request this client itself replaced. It is a
 * scheduling outcome, never a failure: nothing broke, and the operator did
 * nothing to fix. Consumers MUST treat it as "stale, ignore" — rendering it
 * as an error pinned a false "Background estimate failed" badge for the whole
 * of a jog, because current-position placement re-keys on every head move and
 * every re-key supersedes the request held for the previous one.
 */
export class PreparationSupersededError extends Error {
  override readonly name = 'PreparationSupersededError';
  readonly reason: PreparationSupersedeReason;

  constructor(reason: PreparationSupersedeReason) {
    super(SUPERSEDE_MESSAGES[reason]);
    this.reason = reason;
  }
}

/** True for a request this client superseded; false for every real failure. */
export function isPreparationSuperseded(error: unknown): boolean {
  return error instanceof PreparationSupersededError;
}

type QueuedRequest = {
  readonly project: Project;
  readonly options: LargeJobPreparationOptions;
  readonly resolve: (result: LargeJobPreparation) => void;
  readonly reject: (err: Error) => void;
  readonly onProgress?: (progress: OutputCompilationProgress) => void;
};

type ActiveRequest = QueuedRequest & { readonly id: number };

let workerInstance: Worker | null = null;
let nextRequestId = 0;
let activeRequest: ActiveRequest | null = null;
let queuedRequests: ReadonlyArray<QueuedRequest> = [];
let quietWindowTimer: ReturnType<typeof setTimeout> | null = null;
const settledByProject = new WeakMap<Project, Map<string, Promise<LargeJobPreparation>>>();
const settledLru: Array<{
  readonly project: Project;
  readonly key: string;
  readonly promise: Promise<LargeJobPreparation>;
}> = [];

/**
 * Prepare a large job off the main thread. Returns null when workers are
 * unavailable; otherwise a promise for the preview toolpath + estimate that
 * rejects if a newer project (or a newer request for the same project)
 * supersedes it.
 */
export function prepareLargeJobOffThread(
  project: Project,
  options: LargeJobPreparationOptions = {},
  onProgress?: (progress: OutputCompilationProgress) => void,
): Promise<LargeJobPreparation> | null {
  const key = requestKey(options);
  const perProject = cacheFor(project);
  const cached = perProject.get(key);
  if (cached !== undefined) {
    refreshSettledEntry(project, key, cached);
    return cached;
  }
  if (hasWorkForOtherProject(project)) {
    supersedeForNewProject();
  } else {
    // Same project, new options key: held requests were superseded by this
    // one. Only the active compute keeps running — stopping it would kill
    // the worker, and its settled result stays cached anyway.
    rejectQueuedRequests(new PreparationSupersededError('newer-request'));
  }
  if (ensureWorker() === null) return null;
  const promise = new Promise<LargeJobPreparation>((resolve, reject) => {
    queuedRequests = [
      ...queuedRequests,
      {
        project,
        options,
        resolve,
        reject,
        ...(onProgress === undefined ? {} : { onProgress }),
      },
    ];
  });
  perProject.set(key, promise);
  void promise.then(
    () => rememberSettledEntry(project, key, promise),
    () => {
      if (perProject.get(key) === promise) perProject.delete(key);
    },
  );
  dispatchNextRequest();
  return promise;
}

export function resetPreparationWorkerForTests(): void {
  rejectAllPendingAndRetireWorker('preparation worker reset');
  clearSettledEntries();
}

function requestKey(options: LargeJobPreparationOptions): string {
  return JSON.stringify({
    jobOrigin: options.jobOrigin ?? null,
    outputScope: options.outputScope ?? null,
    snapshot: options.snapshot ?? null,
  });
}

function cacheFor(project: Project): Map<string, Promise<LargeJobPreparation>> {
  const existing = settledByProject.get(project);
  if (existing !== undefined) return existing;
  const created = new Map<string, Promise<LargeJobPreparation>>();
  settledByProject.set(project, created);
  return created;
}

function rememberSettledEntry(
  project: Project,
  key: string,
  promise: Promise<LargeJobPreparation>,
): void {
  removeSettledEntry(project, key, promise);
  settledLru.push({ project, key, promise });
  while (settledLru.length > MAX_SETTLED_PREPARATIONS) {
    const evicted = settledLru.shift();
    if (evicted === undefined) break;
    const cache = settledByProject.get(evicted.project);
    if (cache?.get(evicted.key) === evicted.promise) cache.delete(evicted.key);
  }
}

function refreshSettledEntry(
  project: Project,
  key: string,
  promise: Promise<LargeJobPreparation>,
): void {
  const index = settledLru.findIndex(
    (entry) => entry.project === project && entry.key === key && entry.promise === promise,
  );
  if (index < 0) return;
  const [entry] = settledLru.splice(index, 1);
  if (entry !== undefined) settledLru.push(entry);
}

function removeSettledEntry(
  project: Project,
  key: string,
  promise: Promise<LargeJobPreparation>,
): void {
  const index = settledLru.findIndex(
    (entry) => entry.project === project && entry.key === key && entry.promise === promise,
  );
  if (index >= 0) settledLru.splice(index, 1);
}

function clearSettledEntries(): void {
  for (const entry of settledLru) {
    const cache = settledByProject.get(entry.project);
    if (cache?.get(entry.key) === entry.promise) cache.delete(entry.key);
  }
  settledLru.length = 0;
}

function hasWorkForOtherProject(project: Project): boolean {
  if (activeRequest !== null && activeRequest.project !== project) return true;
  return queuedRequests.some((queued) => queued.project !== project);
}

// The operator moved on to a different scene: everything in flight for the
// old one is stale, and the worker may be mid-compute on it.
function supersedeForNewProject(): void {
  rejectQueuedRequests(new PreparationSupersededError('newer-project'));
  if (activeRequest !== null) {
    const stale = activeRequest;
    activeRequest = null;
    // Terminating is the only way to stop the mid-compute worker; respawn
    // immediately so the replacement's spawn + module-graph load overlaps
    // the quiet window instead of serializing in front of the next dispatch.
    retireWorker();
    ensureWorker();
    stale.reject(new PreparationSupersededError('newer-project'));
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
    const created = new Worker(new URL('./preparation-worker.ts', import.meta.url), {
      type: 'module',
    });
    connectCanvasCompilationMainBridge(created);
    created.onmessage = handleWorkerMessage;
    created.onerror = (): void => {
      rejectAllPendingAndRetireWorker('preparation worker errored');
    };
    created.onmessageerror = (): void => {
      rejectAllPendingAndRetireWorker('preparation worker response was not cloneable');
    };
    workerInstance = created;
    return created;
  } catch {
    return null;
  }
}

function handleWorkerMessage(e: MessageEvent<PreparationWorkerResponse>): void {
  if (activeRequest === null || activeRequest.id !== e.data.id) return;
  if (e.data.kind === 'progress') {
    try {
      activeRequest.onProgress?.(e.data.progress);
    } catch {
      // Progress is observational and cannot own request lifecycle.
    }
    return;
  }
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
    rejectQueuedRequests(new Error(WORKER_UNAVAILABLE_MESSAGE));
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
    rejectQueuedRequests(new Error(WORKER_UNAVAILABLE_MESSAGE));
  }
}

function rejectQueuedRequests(error: Error): void {
  const stale = queuedRequests;
  queuedRequests = [];
  for (const queued of stale) {
    queued.reject(error);
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
  // A plain Error on purpose: these paths are real failures (worker crash,
  // teardown), which consumers must surface rather than silently ignore.
  const error = new Error(message);
  if (stale !== null) stale.reject(error);
  rejectQueuedRequests(error);
}

function retireWorker(): void {
  if (workerInstance === null) return;
  const retired = workerInstance;
  workerInstance = null;
  retireCanvasCompilationMainBridge(retired);
  retired.terminate();
}
