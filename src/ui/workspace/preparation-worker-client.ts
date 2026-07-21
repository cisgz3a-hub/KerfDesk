// Main-thread client for the large-job preparation worker (ADR-244). When a
// scene is over the ADR-241/ADR-243 responsiveness budgets the canvas
// preview and live estimate pause instead of freezing the UI; this client
// prepares the same project off-thread so both surfaces still fill in,
// seconds-to-minutes later, without blocking a frame.
//
//   - One request per (project identity, options): the preview and estimate
//     consumers share an in-flight preparation via the WeakMap cache.
//     Requests for the SAME project with different options queue on the
//     worker sequentially.
//   - A request for a DIFFERENT project while work is in flight terminates
//     the worker (a compute cannot be interrupted cooperatively) and rejects
//     every stale promise; callers treat rejection as "stale, ignore".
//   - No watchdog timeout on purpose: a 50M-pixel prepare legitimately runs
//     minutes. Staleness is handled by supersede, crashes by onerror.
//   - Environments without Worker (vitest/jsdom) get null: callers keep the
//     paused fallback behavior.

import type { JobOriginPlacement } from '../../core/job';
import type { OutputScope, Project } from '../../core/scene';
import type {
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';
import type { LiveJobEstimate } from '../laser/live-job-estimate';
import type { PreviewToolpath } from './preview-status';

export type LargeJobPreparation = {
  readonly toolpath: PreviewToolpath;
  readonly estimate: LiveJobEstimate;
};

export type LargeJobPreparationOptions = {
  readonly jobOrigin?: JobOriginPlacement;
  readonly outputScope?: OutputScope;
};

type Pending = {
  readonly project: Project;
  readonly resolve: (result: LargeJobPreparation) => void;
  readonly reject: (err: Error) => void;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
const pendingByRequestId = new Map<number, Pending>();
const settledByProject = new WeakMap<Project, Map<string, Promise<LargeJobPreparation>>>();

/**
 * Prepare a large job off the main thread. Returns null when workers are
 * unavailable; otherwise a promise for the preview toolpath + estimate that
 * rejects if a newer project supersedes it.
 */
export function prepareLargeJobOffThread(
  project: Project,
  options: LargeJobPreparationOptions = {},
): Promise<LargeJobPreparation> | null {
  const key = requestKey(options);
  const perProject = cacheFor(project);
  const cached = perProject.get(key);
  if (cached !== undefined) return cached;
  // The operator moved on to a different scene: everything queued for the
  // old one is stale, and the worker may be mid-compute on it.
  if (hasPendingForOtherProject(project)) {
    rejectAllPendingAndRetireWorker('superseded by a newer project');
  }
  const worker = ensureWorker();
  if (worker === null) return null;
  const promise = requestPreparation(worker, project, options);
  perProject.set(key, promise);
  promise.catch(() => perProject.delete(key));
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

function hasPendingForOtherProject(project: Project): boolean {
  for (const pending of pendingByRequestId.values()) {
    if (pending.project !== project) return true;
  }
  return false;
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
  const pending = pendingByRequestId.get(e.data.id);
  if (pending === undefined) return;
  pendingByRequestId.delete(e.data.id);
  if (e.data.kind === 'ok') {
    pending.resolve({ toolpath: e.data.toolpath, estimate: e.data.estimate });
    return;
  }
  pending.reject(new Error(e.data.message));
}

function requestPreparation(
  worker: Worker,
  project: Project,
  options: LargeJobPreparationOptions,
): Promise<LargeJobPreparation> {
  return new Promise<LargeJobPreparation>((resolve, reject) => {
    nextRequestId += 1;
    const id = nextRequestId;
    pendingByRequestId.set(id, { project, resolve, reject });
    const request: PreparationWorkerRequest = { id, project, ...options };
    try {
      worker.postMessage(request);
    } catch (err) {
      pendingByRequestId.delete(id);
      retireWorker();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function rejectAllPendingAndRetireWorker(message: string): void {
  const pendings = Array.from(pendingByRequestId.values());
  pendingByRequestId.clear();
  retireWorker();
  for (const pending of pendings) {
    pending.reject(new Error(message));
  }
}

function retireWorker(): void {
  if (workerInstance === null) return;
  workerInstance.terminate();
  workerInstance = null;
}
