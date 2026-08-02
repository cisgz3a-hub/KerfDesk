import type { PagedAssetManifest, PagedAssetProgress } from './paged-asset-stager';
import type {
  PagedAssetStageRequest,
  PagedAssetWorkerRequest,
  PagedAssetWorkerResponse,
} from './paged-asset-worker-protocol';

export type PagedAssetWorkerProgress =
  | { readonly phase: 'queued'; readonly queuePosition: number }
  | (PagedAssetProgress & { readonly queuePosition: 0 });

export type StageAssetOffThreadOptions = PagedAssetStageRequest['options'] & {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PagedAssetWorkerProgress) => void;
};

type Pending = {
  readonly request: PagedAssetStageRequest;
  readonly options: StageAssetOffThreadOptions;
  readonly resolve: (manifest: PagedAssetManifest) => void;
  readonly reject: (error: Error) => void;
  readonly handleAbort: () => void;
  cancelRequested: boolean;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
let activeRequestId: number | null = null;
const pendingById = new Map<number, Pending>();
const queue: number[] = [];

export function stageAssetOffThread(
  blob: Blob,
  options: StageAssetOffThreadOptions,
): Promise<PagedAssetManifest> | null {
  if (ensureWorker() === null) return null;
  if (options.signal?.aborted === true) return Promise.reject(abortError());
  const id = ++nextRequestId;
  return new Promise((resolve, reject) => {
    const handleAbort = (): void => cancelRequest(id);
    pendingById.set(id, {
      request: {
        id,
        kind: 'stage',
        blob,
        options: {
          assetId: options.assetId,
          sourceName: options.sourceName,
          createdAtEpochMs: options.createdAtEpochMs,
          ...(options.pageBytes === undefined ? {} : { pageBytes: options.pageBytes }),
        },
      },
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

export function resetPagedAssetWorkerForTests(): void {
  rejectAllPending('paged asset worker reset');
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
    pending.reject(new Error('paged asset worker unavailable'));
    finish(id);
    return;
  }
  activeRequestId = id;
  try {
    worker.postMessage(pending.request);
  } catch (error) {
    pending.reject(toError(error));
    retireWorker();
    finish(id);
  }
  reportQueue();
}

function handleMessage(event: MessageEvent<PagedAssetWorkerResponse>): void {
  const response = event.data;
  const pending = pendingById.get(response.id);
  if (pending === undefined) return;
  if (response.kind === 'progress') {
    if (!pending.cancelRequested) {
      pending.options.onProgress?.({ ...response.progress, queuePosition: 0 });
    }
    return;
  }
  if (response.kind === 'complete') pending.resolve(response.manifest);
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
  try {
    workerInstance?.postMessage({ id, kind: 'cancel' } satisfies PagedAssetWorkerRequest);
  } catch (error) {
    pending.reject(toError(error));
    retireWorker();
    finish(id);
  }
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
    const worker = new Worker(new URL('./paged-asset-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance = worker;
    worker.onmessage = (event) => {
      if (workerInstance === worker) handleMessage(event);
    };
    worker.onerror = () => {
      if (workerInstance === worker) rejectAllPending('paged asset worker errored');
    };
    return worker;
  } catch {
    return null;
  }
}

function rejectAllPending(message: string): void {
  const pending = [...pendingById.values()];
  pendingById.clear();
  queue.splice(0);
  activeRequestId = null;
  retireWorker();
  for (const request of pending) {
    request.options.signal?.removeEventListener('abort', request.handleAbort);
    request.reject(new Error(message));
  }
}

function retireWorker(): void {
  workerInstance?.terminate();
  workerInstance = null;
}

function abortError(): Error {
  const error = new Error('asset staging request cancelled');
  error.name = 'AbortError';
  return error;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
