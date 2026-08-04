// Client for the CNC 3D carve pane's own worker.
//
// Latest-request-wins: the pane only ever wants the newest grid, so a response
// whose id is not the newest is dropped rather than delivered. A superseded
// request rejects with DesignSceneSupersededError, which lets the caller tell a
// newer build apart from a genuine worker failure.
//
// Environments without Worker (vitest/jsdom) get null so the caller can keep
// its synchronous path. This file deliberately owns no fallback of its own:
// what to do without a worker belongs to the consumer.

import type { OutputScope, Project } from '../../core/scene';
import type {
  DesignSceneWorkerRequest,
  DesignSceneWorkerRequestPayload,
  DesignSceneWorkerResponse,
  DesignSceneWorkerSuccessResponse,
} from './design-scene-worker-protocol';
import type { DesignCarveSource } from '../design-studio/preview3d/design-carve-source';
import type { DesignSimulateResult } from '../design-studio/preview3d/design-simulate';
import type { DesignSceneSource } from './use-cnc-3d-scene';
import {
  connectCanvasCompilationMainBridge,
  retireCanvasCompilationMainBridge,
} from './canvas-compilation-main-bridge';

type Pending = {
  readonly id: number;
  readonly resolve: (response: DesignSceneWorkerSuccessResponse) => void;
  readonly reject: (error: Error) => void;
};

let workerInstance: Worker | null = null;
let nextRequestId = 1;
let pending: Pending | null = null;

/** Marks a request abandoned because a newer one replaced it. */
export class DesignSceneSupersededError extends Error {
  constructor() {
    super('design scene request superseded');
    this.name = 'DesignSceneSupersededError';
  }
}

export function isDesignSceneSuperseded(error: unknown): boolean {
  return error instanceof DesignSceneSupersededError;
}

/**
 * Build the pane's scene source off the main thread. Returns null when workers
 * are unavailable, in which case the caller should compute synchronously.
 */
export function computeDesignSceneSourceOffThread(
  project: Project,
  outputScope: OutputScope,
): Promise<DesignSceneSource | null> | null {
  const response = runWorker({ kind: 'scene', project, outputScope });
  if (response === null) return null;
  return response.then((result) => {
    if (result.kind !== 'scene') throw new Error('Design worker returned no scene.');
    return result.source;
  });
}

/** Runs both costly preparation and removal-grid stamping in the shared design worker. */
export function simulateDesignCarveOffThread(
  project: Project,
  source: DesignCarveSource,
): Promise<DesignSimulateResult> | null {
  const response = runWorker({ kind: 'simulation', project, source });
  if (response === null) return null;
  return response.then((result) => {
    if (result.kind !== 'simulation') throw new Error('Design worker returned no simulation.');
    return result.result;
  });
}

/** Latest-run-wins cancellation shared by the pane and explicit bit simulation. */
export function cancelDesignSceneWorkerRequest(): void {
  if (pending === null) return;
  pending.reject(new DesignSceneSupersededError());
  pending = null;
  retireWorker();
}

export function resetDesignSceneWorkerForTests(): void {
  cancelDesignSceneWorkerRequest();
  retireWorker();
  nextRequestId = 1;
}

function runWorker(
  payload: DesignSceneWorkerRequestPayload,
): Promise<DesignSceneWorkerSuccessResponse> | null {
  // Only the newest grid matters. Retiring the previous request here means a
  // burst of edits or Simulate clicks cannot retain or enqueue stale work.
  cancelDesignSceneWorkerRequest();
  const worker = ensureWorker();
  if (worker === null) return null;
  const id = nextRequestId;
  nextRequestId += 1;
  let active!: Pending;
  const promise = new Promise<DesignSceneWorkerSuccessResponse>((resolve, reject) => {
    active = { id, resolve, reject };
    pending = active;
  });
  const request: DesignSceneWorkerRequest = { ...payload, id };
  try {
    worker.postMessage(request);
  } catch (error) {
    if (pending === active) pending = null;
    retireWorker();
    active.reject(error instanceof Error ? error : new Error(String(error)));
  }
  return promise;
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    const created = new Worker(new URL('./design-scene-worker.ts', import.meta.url), {
      type: 'module',
    });
    connectCanvasCompilationMainBridge(created);
    workerInstance = created;
  } catch {
    return null;
  }
  workerInstance.onmessage = handleMessage;
  workerInstance.onerror = (): void => {
    // A dead worker must not strand the pane forever: fail the in-flight
    // request and drop the instance so the next build starts a fresh one.
    pending?.reject(new Error('design scene worker errored'));
    pending = null;
    retireWorker();
  };
  workerInstance.onmessageerror = (): void => {
    pending?.reject(new Error('design scene worker response was not cloneable'));
    pending = null;
    retireWorker();
  };
  return workerInstance;
}

function retireWorker(): void {
  if (workerInstance === null) return;
  const retired = workerInstance;
  workerInstance = null;
  retireCanvasCompilationMainBridge(retired);
  retired.terminate();
}

function handleMessage(e: MessageEvent<DesignSceneWorkerResponse>): void {
  const response = e.data;
  const active = pending;
  if (active === null || active.id !== response.id) return;
  pending = null;
  if (response.kind === 'error') {
    active.reject(new Error(response.message));
    return;
  }
  active.resolve(response);
}
