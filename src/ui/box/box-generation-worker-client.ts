// Main-thread client for src/ui/box/box-generation-worker.ts.
//
// One worker is kept warm and reused for every request, routed by the request
// id the protocol already carries. The worker's module graph pulls in the
// clipper2-ts wasm/JS bundle (~423 KB), so spawning one per preview meant
// reloading that graph on every spec change — the dominant cost of a box
// preview, and paid again for each keystroke.
//
// Cancel and supersede therefore drop the id instead of terminating: the box
// generator runs synchronously inside the worker and cannot be interrupted, so
// a stale generation runs to completion either way and its late response is
// dropped by id in handleWorkerMessage. Request ids are minted here rather than
// supplied by callers precisely because that dropping is id-based: the box
// dialog is conditionally mounted, so a component-scoped counter restarts on
// every reopen and would re-mint the id of a cancelled generation that is still
// running inside the shared worker — whose late response would then resolve the
// new request with the old spec's panels. Terminate is reserved for the fatal
// paths where the worker or its channel can no longer be trusted — runtime
// error, undeserializable response, and a failed postMessage — after which the
// next request spawns a fresh worker rather than poisoning the session.

import type { BoxSpec, GenerateBoxResult } from '../../core/box';
import type {
  BoxGenerationMetrics,
  BoxGenerationWorkerRequest,
  BoxGenerationWorkerResponse,
} from './box-generation-worker-protocol';

export class BoxGenerationCancelledError extends Error {
  override readonly name = 'BoxGenerationCancelledError';

  constructor() {
    super('Box generation cancelled');
  }
}

export type BoxGenerationTask = {
  /** Protocol id this generation was posted under. Unique for the session. */
  readonly id: number;
  readonly promise: Promise<BoxGenerationWorkerResult>;
  readonly cancel: () => void;
};

export type BoxGenerationWorkerResult = {
  readonly result: GenerateBoxResult;
  readonly metrics: BoxGenerationMetrics | null;
};

type PendingRequest = {
  readonly resolve: (value: BoxGenerationWorkerResult) => void;
  readonly reject: (error: Error) => void;
};

const WORKER_ERROR_MESSAGE = 'Background box generation worker errored.';
const MESSAGE_ERROR_MESSAGE = 'Background box generation response could not be read.';

let workerInstance: Worker | null = null;
let nextRequestId = 0;
const pendingByRequestId = new Map<number, PendingRequest>();

/**
 * Post one box generation to the shared worker. The returned task carries the
 * id the request was posted under so callers can track ownership of the reply.
 */
export function startBoxGeneration(spec: BoxSpec): BoxGenerationTask | null {
  const worker = ensureWorker();
  if (worker === null) return null;
  nextRequestId += 1;
  const id = nextRequestId;
  const promise = new Promise<BoxGenerationWorkerResult>((resolve, reject) => {
    pendingByRequestId.set(id, { resolve, reject });
    const request: BoxGenerationWorkerRequest = { kind: 'generate', id, spec };
    try {
      worker.postMessage(request);
    } catch (error) {
      failAllAndRetire(error instanceof Error ? error.message : String(error));
    }
  });
  return { id, promise, cancel: () => cancelRequest(id) };
}

function cancelRequest(id: number): void {
  const pending = pendingByRequestId.get(id);
  if (pending === undefined) return;
  pendingByRequestId.delete(id);
  pending.reject(new BoxGenerationCancelledError());
}

// Lazily construct the shared worker. Returns null when the runtime has no
// Worker constructor (vitest, SSR) or the worker chunk cannot be resolved, so
// callers fall back to generating synchronously for this request.
function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('./box-generation-worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (): void => failAllAndRetire(WORKER_ERROR_MESSAGE);
    worker.onmessageerror = (): void => failAllAndRetire(MESSAGE_ERROR_MESSAGE);
    workerInstance = worker;
    return worker;
  } catch {
    return null;
  }
}

function handleWorkerMessage(event: MessageEvent<BoxGenerationWorkerResponse>): void {
  const pending = pendingByRequestId.get(event.data.id);
  // An untracked id belongs to a cancelled or superseded request the worker had
  // already started. Dropping it is the whole point of keeping the worker warm.
  if (pending === undefined) return;
  pendingByRequestId.delete(event.data.id);
  if (event.data.kind === 'fatal') {
    // A fatal geometry failure is scoped to its request; the worker itself is
    // still healthy and must keep serving later specs.
    pending.reject(new Error(event.data.message));
    return;
  }
  pending.resolve({ result: event.data.result, metrics: event.data.metrics });
}

function failAllAndRetire(message: string): void {
  retireWorker();
  const pendings = Array.from(pendingByRequestId.values());
  pendingByRequestId.clear();
  for (const pending of pendings) {
    pending.reject(new Error(message));
  }
}

function retireWorker(): void {
  if (workerInstance === null) return;
  workerInstance.onmessage = null;
  workerInstance.onerror = null;
  workerInstance.onmessageerror = null;
  workerInstance.terminate();
  workerInstance = null;
}
