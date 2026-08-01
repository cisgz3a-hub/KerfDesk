import type { KerfCheckWorkerRequest, KerfCheckWorkerResponse } from './kerf-check-worker-protocol';
import type { KerfOutputParity } from './editor-kerf-output-parity';

/** Cancellable ownership of one target-scoped background kerf check. */
export type KerfCheckWorkerHandle = {
  readonly result: Promise<KerfOutputParity | null>;
  readonly cancel: () => void;
};

/**
 * Start one target-scoped kerf analysis off the UI thread. The caller owns
 * cancellation; unsupported worker environments receive no optional advisory.
 */
export function startKerfCheckWorker(
  request: KerfCheckWorkerRequest,
): KerfCheckWorkerHandle | null {
  if (typeof Worker === 'undefined') return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./kerf-check-worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
  let workerRequest: KerfCheckWorkerRequest;
  try {
    workerRequest = {
      ...request,
      composite: {
        width: request.composite.width,
        height: request.composite.height,
        data: request.composite.data.slice(),
      },
    };
  } catch {
    worker.terminate();
    return null;
  }

  let cancelRequest = (): void => undefined;
  const result = new Promise<KerfOutputParity | null>((resolve, reject) => {
    let isSettled = false;
    const retire = (): void => {
      worker.terminate();
      isSettled = true;
    };
    worker.onmessage = (event: MessageEvent<KerfCheckWorkerResponse>): void => {
      if (isSettled) return;
      retire();
      if (event.data.kind === 'ok') resolve(event.data.parity);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (): void => {
      if (isSettled) return;
      retire();
      reject(new Error('Background kerf check worker errored.'));
    };
    cancelRequest = (): void => {
      if (isSettled) return;
      retire();
      resolve(null);
    };
    try {
      // The copied Uint8ClampedArray owns a newly allocated, non-shared ArrayBuffer.
      worker.postMessage(workerRequest, [workerRequest.composite.data.buffer as ArrayBuffer]);
    } catch (error) {
      retire();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return { result, cancel: () => cancelRequest() };
}
