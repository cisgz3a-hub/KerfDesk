import type {
  PngPagedImportOptions,
  PngPagedImportProgress,
  PngPagedImportResult,
} from './png-paged-import';
import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import type { PngImportWorkerRequest, PngImportWorkerResponse } from './png-import-worker-protocol';

export type PngImportWorkerProgress =
  | { readonly phase: 'queued'; readonly queuePosition: number }
  | (PngPagedImportProgress & { readonly queuePosition: 0 });

export type PngImportOffThreadOptions = Omit<PngPagedImportOptions, 'signal' | 'onProgress'> & {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PngImportWorkerProgress) => void;
};

type Pending = {
  readonly source: Blob;
  readonly options: PngImportOffThreadOptions;
  readonly resolve: (result: PngPagedImportResult) => void;
  readonly reject: (error: Error) => void;
  readonly handleAbort: () => void;
  cancelRequested: boolean;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
let activeRequestId: number | null = null;
const pendingById = new Map<number, Pending>();
const queue: number[] = [];

export function importPngOffThread(
  blob: Blob,
  options: PngImportOffThreadOptions,
): Promise<PngPagedImportResult> | null {
  if (ensureWorker() === null) return null;
  if (options.signal?.aborted === true) return Promise.reject(abortError());
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    const handleAbort = (): void => cancelRequest(id);
    pendingById.set(id, {
      source: blob,
      options,
      resolve,
      reject,
      handleAbort,
      cancelRequested: false,
    });
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    queue.push(id);
    reportQueue();
    startNext();
  });
}

export function resetPngImportWorkerForTests(): Promise<void> {
  return rejectAllPendingAfterCleanup('PNG import worker reset');
}

function startNext(): void {
  if (activeRequestId !== null) return;
  const id = queue.shift();
  if (id === undefined) return;
  const pending = pendingById.get(id);
  if (pending === undefined) {
    startNext();
    return;
  }
  const worker = ensureWorker();
  if (worker === null) {
    pending.reject(new Error('PNG import worker unavailable'));
    finish(id);
    return;
  }
  activeRequestId = id;
  try {
    const stream = pending.source.stream();
    const request: Extract<PngImportWorkerRequest, { readonly kind: 'import-png' }> = {
      id,
      kind: 'import-png',
      stream,
      source: {
        byteLength: pending.source.size,
        mimeType: pending.source.type,
      },
      options: workerOptions(pending.options),
    };
    worker.postMessage(request, [stream]);
  } catch (error) {
    pending.reject(toError(error));
    retireWorker();
    finish(id);
  }
  reportQueue();
}

function workerOptions(
  options: PngImportOffThreadOptions,
): Omit<PngPagedImportOptions, 'signal' | 'onProgress'> {
  return {
    assetId: options.assetId,
    lumaAssetId: options.lumaAssetId,
    sourceName: options.sourceName,
    createdAtEpochMs: options.createdAtEpochMs,
    maxEdge: options.maxEdge,
    maxPixels: options.maxPixels,
    ...(options.sourcePageBytes === undefined ? {} : { sourcePageBytes: options.sourcePageBytes }),
    ...(options.outputPageBytes === undefined ? {} : { outputPageBytes: options.outputPageBytes }),
  };
}

function handleMessage(event: MessageEvent<PngImportWorkerResponse>): void {
  const response = event.data;
  const pending = pendingById.get(response.id);
  if (pending === undefined) return;
  if (response.kind === 'progress') {
    if (!pending.cancelRequested) {
      pending.options.onProgress?.({ ...response.progress, queuePosition: 0 });
    }
    return;
  }
  if (response.kind === 'complete') pending.resolve(response.result);
  else if (response.kind === 'cancelled') pending.reject(abortError());
  else pending.reject(new Error(response.message));
  finish(response.id);
}

function cancelRequest(id: number): void {
  const pending = pendingById.get(id);
  if (pending === undefined || pending.cancelRequested) return;
  pending.cancelRequested = true;
  if (activeRequestId !== id) {
    const index = queue.indexOf(id);
    if (index >= 0) queue.splice(index, 1);
    pending.reject(abortError());
    finish(id);
    return;
  }
  void terminateActiveAfterCleanup(id, abortError());
}

function finish(id: number): void {
  const pending = pendingById.get(id);
  pending?.options.signal?.removeEventListener('abort', pending.handleAbort);
  pendingById.delete(id);
  if (activeRequestId === id) activeRequestId = null;
  reportQueue();
  startNext();
}

function reportQueue(): void {
  for (const [index, id] of queue.entries()) {
    pendingById.get(id)?.options.onProgress?.({ phase: 'queued', queuePosition: index + 1 });
  }
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('./png-import-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance = worker;
    worker.onmessage = (event) => {
      if (workerInstance === worker) handleMessage(event);
    };
    worker.onerror = () => {
      if (workerInstance === worker) {
        void recoverFromWorkerFailure('PNG import worker errored');
      }
    };
    worker.onmessageerror = () => {
      if (workerInstance === worker) {
        void recoverFromWorkerFailure('PNG import worker returned an unreadable response');
      }
    };
    return worker;
  } catch {
    return null;
  }
}

async function recoverFromWorkerFailure(message: string): Promise<void> {
  const id = activeRequestId;
  if (id === null) {
    retireWorker();
    startNext();
    return;
  }
  await terminateActiveAfterCleanup(id, new Error(message));
}

async function terminateActiveAfterCleanup(id: number, error: Error): Promise<void> {
  const pending = pendingById.get(id);
  if (pending === undefined || activeRequestId !== id) return;
  retireWorker();
  const cleanupFailed = await cleanupRequestAssets(pending);
  pending.reject(cleanupFailed ? cleanupError(error) : error);
  finish(id);
}

async function rejectAllPendingAfterCleanup(message: string): Promise<void> {
  const pending = [...pendingById.entries()];
  const active = activeRequestId === null ? undefined : pendingById.get(activeRequestId);
  pendingById.clear();
  queue.splice(0);
  activeRequestId = null;
  retireWorker();
  const cleanupFailed = active === undefined ? false : await cleanupRequestAssets(active);
  for (const [, request] of pending) {
    request.options.signal?.removeEventListener('abort', request.handleAbort);
    const error = new Error(message);
    request.reject(cleanupFailed ? cleanupError(error) : error);
  }
}

function retireWorker(): void {
  const worker = workerInstance;
  workerInstance = null;
  if (worker === null) return;
  worker.onmessage = null;
  worker.onerror = null;
  worker.onmessageerror = null;
  worker.terminate();
}

async function cleanupRequestAssets(pending: Pending): Promise<boolean> {
  const repository = new IndexedDbPagedAssetRepository();
  let failed = false;
  for (const assetId of [pending.options.assetId, pending.options.lumaAssetId]) {
    try {
      await repository.abort(assetId);
    } catch {
      failed = true;
    }
  }
  return failed;
}

function cleanupError(error: Error): Error {
  const combined = new Error(
    `${error.message}; temporary PNG pages could not be removed and will be retried later.`,
  );
  combined.name = 'PagedAssetCleanupError';
  return combined;
}

function abortError(): Error {
  const error = new Error('PNG import request cancelled');
  error.name = 'AbortError';
  return error;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
