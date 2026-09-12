// Main-thread client for the large-job preparation worker (ADR-244). When a
// scene is over the ADR-241/ADR-243 responsiveness budgets the canvas
// preview and live estimate pause instead of freezing the UI; this client
// prepares the same project off-thread so both surfaces still fill in,
// seconds-to-minutes later, without blocking a frame.
//
//   - One cached capability per exact (project identity, options): full
//     previews also satisfy estimates; estimates alone never satisfy Preview.
//     Only the latest full Preview is retained, with at most four settled
//     entries across both capabilities. Replacement releases old geometry.
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
//     replacement waits for the supersede quiet window and the shared worker
//     memory lane, so a burst of edits costs one new worker and one project
//     clone. Each terminal result retires its worker before yielding the lane
//     to autosave or another preparation; their heaps must not overlap.
//   - No watchdog timeout on purpose: a 50M-pixel prepare legitimately runs
//     minutes. Staleness is handled by supersede, crashes by onerror.
//   - Environments without Worker (vitest/jsdom) get null: callers keep the
//     paused fallback behavior.

import type { Project } from '../../core/scene';
import type { OutputCompilationProgress } from '../../io/gcode/prepare-output-async';
import type {
  LargeJobEstimate,
  LargeJobPreparation,
  LargeJobPreparationOptions,
} from './large-job-preparation';
import type {
  PreparationProjection,
  PreparationWorkerRequest,
  PreparationWorkerResponse,
} from './preparation-worker-protocol';
import {
  connectCanvasCompilationMainBridge,
  retireCanvasCompilationMainBridge,
} from './canvas-compilation-main-bridge';
import { PreparationResultCache } from './preparation-result-cache';
import { PreparationTransferAssembler } from './preparation-transfer-assembler';
import { reserveWorkerMemory } from '../worker-memory-lane';
import type {
  PreparationTransferResponse,
  PreparationTransferAcknowledgement,
} from './preparation-transfer-protocol';

export type {
  LargeJobEstimate,
  LargeJobPreparation,
  LargeJobPreparationOptions,
} from './large-job-preparation';

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
  readonly key: string;
  readonly options: LargeJobPreparationOptions;
  readonly projection: PreparationProjection;
  readonly resolve: (result: LargeJobPreparation | LargeJobEstimate) => void;
  readonly reject: (err: Error) => void;
  readonly onProgress?: (progress: OutputCompilationProgress) => void;
};

type ActiveRequest = QueuedRequest & { readonly id: number };
type MemoryReservation = {
  cancel: (() => void) | null;
  release: (() => void) | null;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
let activeRequest: ActiveRequest | null = null;
let activeTransfer: PreparationTransferAssembler | null = null;
let queuedRequests: ReadonlyArray<QueuedRequest> = [];
let quietWindowTimer: ReturnType<typeof setTimeout> | null = null;
let memoryReservation: MemoryReservation | null = null;
const preparationCache = new PreparationResultCache(MAX_SETTLED_PREPARATIONS);

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
  const cached = preparationCache.get(project, key);
  if (cached?.projection === 'preview') return cached.promise;
  preparationCache.discardSettledPreviews();
  const requested = requestPreparation(project, options, 'preview', onProgress);
  if (requested === null) return null;
  const promise = requested.then((result) => {
    if (!('toolpath' in result))
      throw new Error('preparation worker omitted the requested preview');
    return result;
  });
  preparationCache.set(project, key, { projection: 'preview', promise });
  return promise;
}

/** Return only the exact ETA, reusing a full Preview request when already present. */
export function prepareJobEstimateOffThread(
  project: Project,
  options: LargeJobPreparationOptions = {},
): Promise<LargeJobEstimate> | null {
  const key = requestKey(options);
  const cached = preparationCache.get(project, key);
  if (cached !== undefined) return cached.promise;
  const promise = requestPreparation(project, options, 'estimate');
  if (promise !== null) preparationCache.set(project, key, { projection: 'estimate', promise });
  return promise;
}

function requestPreparation(
  project: Project,
  options: LargeJobPreparationOptions,
  projection: PreparationProjection,
  onProgress?: (progress: OutputCompilationProgress) => void,
): Promise<LargeJobPreparation | LargeJobEstimate> | null {
  const key = requestKey(options);
  if (hasWorkForOtherProject(project)) {
    supersedeForNewProject();
  } else {
    // Keep the same exact options: a queued estimate can be promoted to a
    // full Preview, satisfying both consumers with the same compile.
    rejectQueuedRequests(new PreparationSupersededError('newer-request'), key);
  }
  if (typeof Worker === 'undefined') return null;
  const promise = new Promise<LargeJobPreparation | LargeJobEstimate>((resolve, reject) => {
    const held = queuedRequests.find((request) => request.key === key);
    const progress = onProgress ?? held?.onProgress;
    const next: QueuedRequest = {
      project,
      key,
      options,
      projection,
      resolve: (result) => {
        held?.resolve(result);
        resolve(result);
      },
      reject: (error) => {
        held?.reject(error);
        reject(error);
      },
      ...(progress === undefined ? {} : { onProgress: progress }),
    };
    queuedRequests =
      held === undefined
        ? [...queuedRequests, next]
        : queuedRequests.map((request) => (request === held ? next : request));
  });
  dispatchNextRequest();
  return promise;
}

export function resetPreparationWorkerForTests(): void {
  rejectAllPendingAndRetireWorker('preparation worker reset');
  preparationCache.clear();
}

function requestKey(options: LargeJobPreparationOptions): string {
  return JSON.stringify({
    jobOrigin: options.jobOrigin ?? null,
    outputScope: options.outputScope ?? null,
    snapshot: options.snapshot ?? null,
  });
}

function hasWorkForOtherProject(project: Project): boolean {
  if (activeRequest !== null && activeRequest.project !== project) return true;
  return queuedRequests.some((queued) => queued.project !== project);
}

// The operator moved on to a different scene: everything in flight for the
// old one is stale, and the worker may be mid-compute on it.
function supersedeForNewProject(): void {
  rejectQueuedRequests(new PreparationSupersededError('newer-project'));
  const stale = activeRequest;
  activeRequest = null;
  // Also cancel a reservation that has not been granted. Its replacement
  // must not jump ahead of an autosave already waiting for this worker.
  retireWorker();
  stale?.reject(new PreparationSupersededError('newer-project'));
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
  let created: Worker | null = null;
  try {
    const worker = new Worker(new URL('./preparation-worker.ts', import.meta.url), {
      type: 'module',
    });
    created = worker;
    connectCanvasCompilationMainBridge(worker);
    worker.onmessage = (event): void => {
      if (workerInstance === worker) handleWorkerMessage(event);
    };
    worker.onerror = (): void => {
      if (workerInstance === worker) rejectAllPendingAndRetireWorker('preparation worker errored');
    };
    worker.onmessageerror = (): void => {
      if (workerInstance === worker)
        rejectAllPendingAndRetireWorker('preparation worker response was not cloneable');
    };
    workerInstance = worker;
    return worker;
  } catch {
    if (created !== null) {
      try {
        retireCanvasCompilationMainBridge(created);
      } finally {
        created.terminate();
      }
    }
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
  if (isTransferResponse(e.data)) {
    handleTransferMessage(e.data);
    return;
  }
  if (activeTransfer !== null && e.data.kind !== 'error') {
    rejectAllPendingAndRetireWorker('preparation worker mixed response formats');
    return;
  }
  const settled = activeRequest;
  activeRequest = null;
  retireWorker();
  if (e.data.kind === 'ok') {
    settled.resolve({
      toolpath: e.data.toolpath,
      estimate: e.data.estimate,
      ...(e.data.jobOriginOffset === undefined ? {} : { jobOriginOffset: e.data.jobOriginOffset }),
    });
  } else if (e.data.kind === 'estimate') {
    settled.resolve({ estimate: e.data.estimate });
  } else {
    settled.reject(new Error(e.data.message));
  }
  dispatchNextRequest();
}

function isTransferResponse(
  response: PreparationWorkerResponse,
): response is PreparationTransferResponse {
  return (
    response.kind === 'transfer-start' ||
    response.kind === 'transfer-chunk' ||
    response.kind === 'transfer-complete'
  );
}

function handleTransferMessage(packet: PreparationTransferResponse): void {
  try {
    let result: LargeJobPreparation | null = null;
    if (packet.kind === 'transfer-start') {
      if (activeTransfer !== null) throw new Error('duplicate preparation transfer header');
      activeTransfer = new PreparationTransferAssembler(packet);
    } else {
      if (activeTransfer === null) throw new Error('preparation transfer missing header');
      result = activeTransfer.accept(packet);
    }
    const acknowledgement: PreparationTransferAcknowledgement = {
      id: packet.id,
      sequence: packet.sequence,
      kind: 'transfer-ack',
    };
    workerInstance?.postMessage(acknowledgement);
    if (result === null) return;
    const settled = activeRequest;
    activeRequest = null;
    retireWorker();
    settled?.resolve(result);
    dispatchNextRequest();
  } catch (error) {
    // Corrupt/incomplete transfers never become a Preview or a cache entry.
    // Retiring the worker also abandons its acknowledgement wait.
    rejectAllPendingAndRetireWorker(error instanceof Error ? error.message : String(error));
  }
}

function dispatchNextRequest(): void {
  if (
    activeRequest !== null ||
    quietWindowTimer !== null ||
    memoryReservation !== null ||
    queuedRequests.length === 0
  )
    return;
  const reservation: MemoryReservation = { cancel: null, release: null };
  memoryReservation = reservation;
  reservation.cancel = reserveWorkerMemory((release) => {
    if (memoryReservation !== reservation) {
      release();
      return;
    }
    reservation.release = release;
    dispatchReservedRequest();
  });
  // A free grant can fail or even complete synchronously before reserve
  // returns. Its old token must never overwrite or release a newer owner.
  if (memoryReservation !== reservation) reservation.cancel();
}

function dispatchReservedRequest(): void {
  // Options/project may have coalesced while autosave owned the lane.
  const next = queuedRequests[0];
  if (next === undefined || quietWindowTimer !== null) {
    retireWorker();
    return;
  }
  const worker = ensureWorker();
  if (worker === null) {
    rejectQueuedRequests(new Error(WORKER_UNAVAILABLE_MESSAGE));
    retireWorker();
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
    ...(active.projection === 'estimate' ? { projection: 'estimate' as const } : {}),
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

function rejectQueuedRequests(error: Error, keepKey?: string): void {
  const stale = queuedRequests.filter((request) => request.key !== keepKey);
  queuedRequests = queuedRequests.filter((request) => request.key === keepKey);
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
  activeTransfer = null;
  const retired = workerInstance;
  workerInstance = null;
  const reservation = memoryReservation;
  memoryReservation = null;
  try {
    if (retired !== null) {
      retired.onmessage = null;
      retired.onerror = null;
      retired.onmessageerror = null;
      try {
        retireCanvasCompilationMainBridge(retired);
      } finally {
        retired.terminate();
      }
    }
  } finally {
    (reservation?.release ?? reservation?.cancel)?.();
  }
}
