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
  DesignSceneWorkerResponse,
} from './design-scene-worker-protocol';
import type { DesignSceneSource } from './use-cnc-3d-scene';

type Pending = {
  readonly id: number;
  readonly resolve: (source: DesignSceneSource | null) => void;
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
  const worker = ensureWorker();
  if (worker === null) return null;
  // Only the newest grid matters. Retiring the previous request here means a
  // burst of bit changes settles to one delivered result even though the worker
  // finishes each in turn.
  pending?.reject(new DesignSceneSupersededError());
  const id = nextRequestId;
  nextRequestId += 1;
  const promise = new Promise<DesignSceneSource | null>((resolve, reject) => {
    pending = { id, resolve, reject };
  });
  const request: DesignSceneWorkerRequest = { id, project, outputScope };
  worker.postMessage(request);
  return promise;
}

export function resetDesignSceneWorkerForTests(): void {
  pending?.reject(new DesignSceneSupersededError());
  pending = null;
  workerInstance?.terminate();
  workerInstance = null;
  nextRequestId = 1;
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  workerInstance = new Worker(new URL('./design-scene-worker.ts', import.meta.url), {
    type: 'module',
  });
  workerInstance.onmessage = handleMessage;
  workerInstance.onerror = (): void => {
    // A dead worker must not strand the pane forever: fail the in-flight
    // request and drop the instance so the next build starts a fresh one.
    pending?.reject(new Error('design scene worker errored'));
    pending = null;
    workerInstance?.terminate();
    workerInstance = null;
  };
  return workerInstance;
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
  active.resolve(response.source);
}
