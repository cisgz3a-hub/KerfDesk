// Main-thread scheduler for idle canvas markers. Only the latest project is
// useful, so a new request terminates an in-flight worker instead of queueing
// seconds of stale V-carve plans behind it.

import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import type { IdleCanvasMotionPlanRequest } from './idle-canvas-motion-plan';
import type {
  IdleCanvasMotionWorkerRequest,
  IdleCanvasMotionWorkerResponse,
} from './idle-canvas-motion-worker-protocol';

type Pending = {
  readonly id: number;
  readonly resolve: (plan: CanvasMotionPlan | null) => void;
  readonly reject: (error: Error) => void;
};

let workerInstance: Worker | null = null;
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
  supersedePending();
  const worker = ensureWorker();
  if (worker === null) return null;
  nextRequestId += 1;
  const id = nextRequestId;
  const promise = new Promise<CanvasMotionPlan | null>((resolve, reject) => {
    pending = { id, resolve, reject };
  });
  const message: IdleCanvasMotionWorkerRequest = { id, request };
  try {
    worker.postMessage(message);
  } catch (error) {
    const active = pending;
    pending = null;
    retireWorker();
    active?.reject(error instanceof Error ? error : new Error(String(error)));
  }
  return promise;
}

export function cancelIdleCanvasMotionPlanOffThread(): void {
  supersedePending();
}

export function resetIdleCanvasMotionWorkerForTests(): void {
  supersedePending();
  retireWorker();
  nextRequestId = 0;
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    const created = new Worker(new URL('./idle-canvas-motion-worker.ts', import.meta.url), {
      type: 'module',
    });
    created.onmessage = (event: MessageEvent<IdleCanvasMotionWorkerResponse>): void => {
      if (workerInstance !== created) return;
      handleMessage(event.data);
    };
    created.onerror = (): void => {
      if (workerInstance !== created) return;
      const active = pending;
      pending = null;
      retireWorker();
      active?.reject(new Error('idle canvas motion worker errored'));
    };
    workerInstance = created;
    return created;
  } catch {
    return null;
  }
}

function handleMessage(response: IdleCanvasMotionWorkerResponse): void {
  const active = pending;
  if (active === null || active.id !== response.id) return;
  pending = null;
  if (response.kind === 'error') active.reject(new Error(response.message));
  else active.resolve(response.plan);
}

function supersedePending(): void {
  const active = pending;
  if (active === null) return;
  pending = null;
  retireWorker();
  active.reject(new IdleCanvasMotionSupersededError());
}

function retireWorker(): void {
  workerInstance?.terminate();
  workerInstance = null;
}
