// Main-thread scheduler for idle canvas markers. Only the latest project is
// useful, so a new request terminates an in-flight worker instead of queueing
// stale plans. Like Preview/ETA and autosave, this worker compiles a complete
// project and must reserve their shared memory lane before construction or
// cloning. Every terminal response retires its heap before releasing the lane.

import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { packProjectMessage } from '../packed-project-transfer';
import { reserveWorkerMemory } from '../worker-memory-lane';
import type { IdleCanvasMotionPlanRequest } from './idle-canvas-motion-plan';
import type {
  IdleCanvasMotionWorkerRequest,
  IdleCanvasMotionWorkerResponse,
} from './idle-canvas-motion-worker-protocol';
import {
  connectCanvasCompilationMainBridge,
  retireCanvasCompilationMainBridge,
} from './canvas-compilation-main-bridge';

type Pending = {
  readonly id: number;
  readonly resolve: (plan: CanvasMotionPlan | null) => void;
  readonly reject: (error: Error) => void;
  worker: Worker | null;
  cancelReservation: (() => void) | null;
  releaseReservation: (() => void) | null;
};

let pending: Pending | null = null;
let nextRequestId = 0;

export class IdleCanvasMotionSupersededError extends Error {
  override readonly name = 'IdleCanvasMotionSupersededError';

  constructor() {
    super('idle canvas motion preparation superseded');
  }
}

export function isIdleCanvasMotionSuperseded(error: unknown): boolean {
  return error instanceof IdleCanvasMotionSupersededError;
}

export function prepareIdleCanvasMotionPlanOffThread(
  request: IdleCanvasMotionPlanRequest,
): Promise<CanvasMotionPlan | null> | null {
  if (typeof Worker === 'undefined') {
    supersedePending();
    return null;
  }
  nextRequestId += 1;
  const id = nextRequestId;
  return new Promise<CanvasMotionPlan | null>((resolve, reject) => {
    const active: Pending = {
      id,
      resolve,
      reject,
      worker: null,
      cancelReservation: null,
      releaseReservation: null,
    };
    const stale = pending;
    // Install the new owner before releasing the previous reservation. Its
    // release can synchronously start another client that requests newer work.
    pending = active;
    if (stale !== null) retireSuperseded(stale);
    if (pending !== active) return;
    active.cancelReservation = reserveWorkerMemory((release) => {
      if (pending !== active) {
        release();
        return;
      }
      active.releaseReservation = release;
      startWorker(active, request);
    });
    // A free grant may fail or finish before reserve returns. Its token is
    // local to this request and must never release a replacement's lane.
    if (pending !== active) active.cancelReservation();
  });
}

export function cancelIdleCanvasMotionPlanOffThread(): void {
  supersedePending();
}

export function resetIdleCanvasMotionWorkerForTests(): void {
  supersedePending();
  nextRequestId = 0;
}

function startWorker(active: Pending, request: IdleCanvasMotionPlanRequest): void {
  try {
    const created = new Worker(new URL('./idle-canvas-motion-worker.ts', import.meta.url), {
      type: 'module',
    });
    active.worker = created;
    connectCanvasCompilationMainBridge(created);
    created.onmessage = (event: MessageEvent<IdleCanvasMotionWorkerResponse>): void => {
      if (pending !== active || active.worker !== created) return;
      handleMessage(active, event.data);
    };
    created.onerror = (): void => {
      failRequest(active, new Error('idle canvas motion worker errored'));
    };
    created.onmessageerror = (): void => {
      failRequest(active, new Error('idle canvas motion worker response was not cloneable'));
    };
    // Dense geometry crosses as transferred buffers rather than a structured
    // clone of the whole object graph (packed-project-transfer.ts).
    const packed = packProjectMessage(request.project);
    const message: IdleCanvasMotionWorkerRequest = {
      id: active.id,
      request:
        packed.message === request.project ? request : { ...request, project: packed.message },
    };
    if (packed.transfer.length === 0) created.postMessage(message);
    else created.postMessage(message, packed.transfer);
  } catch (error) {
    failRequest(active, error instanceof Error ? error : new Error(String(error)));
  }
}

function handleMessage(active: Pending, response: IdleCanvasMotionWorkerResponse): void {
  if (pending !== active || active.id !== response.id) return;
  pending = null;
  retireWorker(active);
  if (response.kind === 'error') active.reject(new Error(response.message));
  else active.resolve(response.plan);
}

function failRequest(active: Pending, error: Error): void {
  if (pending !== active) return;
  pending = null;
  retireWorker(active);
  active.reject(error);
}

function supersedePending(): void {
  const active = pending;
  if (active === null) return;
  pending = null;
  retireSuperseded(active);
}

function retireSuperseded(active: Pending): void {
  retireWorker(active);
  active.reject(new IdleCanvasMotionSupersededError());
}

function retireWorker(active: Pending): void {
  const retired = active.worker;
  active.worker = null;
  const release = active.releaseReservation ?? active.cancelReservation;
  active.releaseReservation = null;
  active.cancelReservation = null;
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
    release?.();
  }
}
