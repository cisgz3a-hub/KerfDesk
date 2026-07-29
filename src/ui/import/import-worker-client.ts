// Main-thread client for the import worker (Phase 3 of the large-file plan).
//
// Unlike the ADR-244 preparation client there is no single-flight cache and no
// supersede: each import is an independent one-shot request the operator asked
// for, so concurrent imports simply queue on the one worker and every result is
// still wanted. What IS shared with that client is the contract that matters for
// the test suite — `null` when Worker is unavailable (vitest/jsdom), so every
// caller keeps a working synchronous path.

import type { ParseDxfResult } from '../../io/dxf';
import type { ParseGcodeProgramResult } from '../../io/gcode';
import type { ParseStlResult } from '../../io/stl';
import type { ImportWorkerRequest, ImportWorkerResponse } from './import-worker-protocol';

type Pending = {
  readonly resolve: (response: ImportWorkerResponse) => void;
  readonly reject: (err: Error) => void;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
const pendingByRequestId = new Map<number, Pending>();

/** Parse a DXF off the main thread, or null when workers are unavailable. */
export function parseDxfOffThread(
  blob: Blob,
  objectId: string,
  source: string,
): Promise<ParseDxfResult> | null {
  return request({ kind: 'dxf', blob, objectId, source }, 'dxf');
}

/** Parse a G-code program off the main thread, or null when unavailable. */
export function parseGcodeOffThread(blob: Blob): Promise<ParseGcodeProgramResult> | null {
  return request({ kind: 'gcode', blob }, 'gcode');
}

/** Parse an STL off the main thread, or null when unavailable. */
export function parseStlOffThread(blob: Blob): Promise<ParseStlResult> | null {
  return request({ kind: 'stl', blob }, 'stl');
}

export function resetImportWorkerForTests(): void {
  rejectAllPendingAndRetireWorker('import worker reset');
}

// A plain Omit over a union collapses the discriminant into the shared keys, so
// the per-kind fields (objectId/source) would be rejected. Distribute instead.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<ImportWorkerRequest, 'id'>;

// The `kind` argument is what ties the untyped response back to the caller's
// result type; a mismatched kind means the worker answered the wrong request and
// is treated as an error rather than mis-cast.
function request<K extends ImportWorkerResponse['kind'], R>(
  body: RequestBody,
  kind: K,
): Promise<R> | null {
  const worker = ensureWorker();
  if (worker === null) return null;
  return new Promise<R>((resolve, reject) => {
    nextRequestId += 1;
    const id = nextRequestId;
    pendingByRequestId.set(id, {
      resolve: (response) => {
        if (response.kind === 'error') {
          reject(new Error(response.message));
          return;
        }
        if (response.kind !== kind) {
          reject(new Error(`import worker answered '${response.kind}' for a '${kind}' request`));
          return;
        }
        resolve(response.result as R);
      },
      reject,
    });
    try {
      worker.postMessage({ id, ...body } as ImportWorkerRequest);
    } catch (err) {
      pendingByRequestId.delete(id);
      retireWorker();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    workerInstance = new Worker(new URL('./import-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = handleWorkerMessage;
    workerInstance.onerror = (): void => {
      rejectAllPendingAndRetireWorker('import worker errored');
    };
    return workerInstance;
  } catch {
    return null;
  }
}

function handleWorkerMessage(e: MessageEvent<ImportWorkerResponse>): void {
  const pending = pendingByRequestId.get(e.data.id);
  if (pending === undefined) return;
  pendingByRequestId.delete(e.data.id);
  pending.resolve(e.data);
}

function rejectAllPendingAndRetireWorker(message: string): void {
  const pendings = Array.from(pendingByRequestId.values());
  pendingByRequestId.clear();
  retireWorker();
  for (const pending of pendings) pending.reject(new Error(message));
}

function retireWorker(): void {
  if (workerInstance === null) return;
  workerInstance.terminate();
  workerInstance = null;
}
