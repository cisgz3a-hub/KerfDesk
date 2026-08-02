// Main-thread client for src/ui/image-editor/kerf-check-worker.ts.
//
// One worker is kept warm and reused for every check, routed by the request id
// the protocol carries. useKerfCheck re-fires after every 400 ms edit pause, so
// spawning a worker per check and terminating it after a single response made
// each pause pay a cold spawn plus a full reload of the worker's module graph
// (the raster compile chain behind computeKerfOutputParity) — served unbundled,
// one request per module, in Vite dev.
//
// Cancel and supersede therefore drop the id instead of terminating: the parity
// computation runs synchronously inside the worker and cannot be interrupted,
// so a stale check runs to completion either way and its late response is
// dropped by id in handleWorkerMessage. Terminate is reserved for the fatal
// paths where the worker or its channel can no longer be trusted — runtime
// error, undeserializable response, and a failed postMessage — after which the
// next check spawns a fresh worker rather than poisoning the session.

import type { KerfOutputParity } from './editor-kerf-output-parity';
import type {
  KerfCheckWorkerPayload,
  KerfCheckWorkerRequest,
  KerfCheckWorkerResponse,
} from './kerf-check-worker-protocol';

/** Cancellable ownership of one target-scoped background kerf check. */
export type KerfCheckWorkerHandle = {
  readonly result: Promise<KerfOutputParity | null>;
  readonly cancel: () => void;
};

type PendingCheck = {
  readonly resolve: (parity: KerfOutputParity | null) => void;
  readonly reject: (error: Error) => void;
};

const WORKER_ERROR_MESSAGE = 'Background kerf check worker errored.';
const MESSAGE_ERROR_MESSAGE = 'Background kerf check response could not be read.';

let workerInstance: Worker | null = null;
let nextRequestId = 0;
const pendingByRequestId = new Map<number, PendingCheck>();

/**
 * Start one target-scoped kerf analysis off the UI thread. The caller owns
 * cancellation; unsupported worker environments receive no optional advisory.
 */
export function startKerfCheckWorker(
  payload: KerfCheckWorkerPayload,
): KerfCheckWorkerHandle | null {
  const worker = ensureWorker();
  if (worker === null) return null;
  nextRequestId += 1;
  const id = nextRequestId;
  const request = requestWithOwnedComposite(payload, id);
  if (request === null) return null;

  const result = new Promise<KerfOutputParity | null>((resolve, reject) => {
    pendingByRequestId.set(id, { resolve, reject });
    try {
      // The copied Uint8ClampedArray owns a newly allocated, non-shared ArrayBuffer.
      worker.postMessage(request, [request.composite.data.buffer as ArrayBuffer]);
    } catch (error) {
      failAllAndRetire(error instanceof Error ? error.message : String(error));
    }
  });
  return { result, cancel: () => cancelRequest(id) };
}

// The composite cache repaints its pixels in place, so the worker must own a
// copy rather than a view onto the live buffer. A copy that cannot allocate
// fails only this check: the shared worker is untouched and still healthy.
function requestWithOwnedComposite(
  payload: KerfCheckWorkerPayload,
  id: number,
): KerfCheckWorkerRequest | null {
  try {
    return {
      ...payload,
      id,
      composite: {
        width: payload.composite.width,
        height: payload.composite.height,
        data: payload.composite.data.slice(),
      },
    };
  } catch {
    return null;
  }
}

// Cancelling resolves null — the advisory is optional, and a cancelled check
// has no verdict to report. The worker keeps running the stale computation; its
// response is dropped once the id is gone from the pending map.
function cancelRequest(id: number): void {
  const pending = pendingByRequestId.get(id);
  if (pending === undefined) return;
  pendingByRequestId.delete(id);
  pending.resolve(null);
}

// Lazily construct the shared worker. Returns null when the runtime has no
// Worker constructor (vitest, SSR) or the worker chunk cannot be resolved, in
// which case the caller simply shows no advisory.
function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('./kerf-check-worker.ts', import.meta.url), {
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

function handleWorkerMessage(event: MessageEvent<KerfCheckWorkerResponse>): void {
  const pending = pendingByRequestId.get(event.data.id);
  // An untracked id belongs to a cancelled or superseded check the worker had
  // already started. Dropping it is the whole point of keeping the worker warm.
  if (pending === undefined) return;
  pendingByRequestId.delete(event.data.id);
  if (event.data.kind === 'error') {
    // A failed analysis is scoped to its request; the worker itself is still
    // healthy and must keep serving later checks.
    pending.reject(new Error(event.data.message));
    return;
  }
  pending.resolve(event.data.parity);
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
