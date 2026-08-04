// Latest-only main-thread client. Superseding terminates the outer Worker;
// detaching its broker port aborts an active grid task in the shared pool.

import type { RemovalGrid } from '../../core/sim';
import {
  connectCanvasCompilationMainBridge,
  retireCanvasCompilationMainBridge,
} from './canvas-compilation-main-bridge';
import type {
  CncRemovalGridWorkerRequest,
  CncRemovalGridWorkerResponse,
} from './cnc-removal-grid-worker-protocol';

type Pending = {
  readonly id: number;
  readonly resolve: (grid: RemovalGrid | null) => void;
  readonly reject: (error: Error) => void;
};

let workerInstance: Worker | null = null;
let pending: Pending | null = null;
let nextRequestId = 0;

export class CncRemovalGridSupersededError extends Error {
  override readonly name = 'CncRemovalGridSupersededError';

  constructor() {
    super('CNC removal-grid preparation superseded');
  }
}

export function isCncRemovalGridSuperseded(error: unknown): boolean {
  return error instanceof CncRemovalGridSupersededError;
}

export function prepareCncRemovalGridOffThread(
  request: Omit<CncRemovalGridWorkerRequest, 'id'>,
): Promise<RemovalGrid | null> | null {
  supersedePending();
  const worker = ensureWorker();
  if (worker === null) return null;
  nextRequestId += 1;
  const id = nextRequestId;
  const promise = new Promise<RemovalGrid | null>((resolve, reject) => {
    pending = { id, resolve, reject };
  });
  try {
    worker.postMessage({ id, ...request } satisfies CncRemovalGridWorkerRequest);
  } catch (error) {
    const active = pending;
    pending = null;
    retireWorker();
    active?.reject(error instanceof Error ? error : new Error(String(error)));
  }
  return promise;
}

export function cancelCncRemovalGridOffThread(): void {
  supersedePending();
}

export function resetCncRemovalGridWorkerForTests(): void {
  supersedePending();
  retireWorker();
  nextRequestId = 0;
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    const created = new Worker(new URL('./cnc-removal-grid-worker.ts', import.meta.url), {
      type: 'module',
    });
    connectCanvasCompilationMainBridge(created);
    created.onmessage = (event: MessageEvent<CncRemovalGridWorkerResponse>) => {
      if (workerInstance === created) handleMessage(event.data);
    };
    created.onerror = () => failWorker(created, new Error('CNC removal-grid worker errored'));
    created.onmessageerror = () =>
      failWorker(created, new Error('CNC removal-grid response was not cloneable'));
    workerInstance = created;
    return created;
  } catch {
    return null;
  }
}

function handleMessage(response: CncRemovalGridWorkerResponse): void {
  const active = pending;
  if (active === null || active.id !== response.id) return;
  pending = null;
  if (response.kind === 'error') active.reject(new Error(response.message));
  else active.resolve(response.grid);
}

function failWorker(worker: Worker, error: Error): void {
  if (workerInstance !== worker) return;
  const active = pending;
  pending = null;
  retireWorker();
  active?.reject(error);
}

function supersedePending(): void {
  const active = pending;
  if (active === null) return;
  pending = null;
  retireWorker();
  active.reject(new CncRemovalGridSupersededError());
}

function retireWorker(): void {
  if (workerInstance === null) return;
  const retired = workerInstance;
  workerInstance = null;
  retireCanvasCompilationMainBridge(retired);
  retired.terminate();
}
