import type { DeserializeResult as DeserializeProjectResult } from '../../io/project';
import type { ParseSvgResult } from '../../io/svg';
import type { ClbImportResult, LbrnImportResult } from '../../io/lightburn';
import type { DeserializeMaterialLibraryResult } from '../../io/material-library';
import type {
  DocumentImportWorkerRequest,
  DocumentImportWorkerResponse,
} from './document-import-worker-protocol';

export type DocumentImportProgress = {
  readonly phase: 'queued' | 'reading' | 'parsing';
  readonly queuePosition: number;
};

export type DocumentImportRequestOptions = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: DocumentImportProgress) => void;
};

type ResultKind = Exclude<DocumentImportWorkerResponse['kind'], 'progress' | 'error'>;
type Pending = {
  readonly request: DocumentImportWorkerRequest;
  readonly expectedKind: ResultKind;
  readonly resolve: (response: DocumentImportWorkerResponse) => void;
  readonly reject: (error: Error) => void;
  readonly options: DocumentImportRequestOptions;
  readonly handleAbort: () => void;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
let activeRequestId: number | null = null;
const pendingById = new Map<number, Pending>();
const queue: number[] = [];

export function parseProjectOffThread(
  blob: Blob,
  options: DocumentImportRequestOptions = {},
): Promise<DeserializeProjectResult> | null {
  return request({ kind: 'project', blob }, 'project', options);
}

export function parseSvgOffThread(
  blob: Blob,
  objectId: string,
  source: string,
  options: DocumentImportRequestOptions = {},
): Promise<ParseSvgResult> | null {
  return request({ kind: 'svg', blob, objectId, source }, 'svg', options);
}

export function parseLightBurnProjectOffThread(
  blob: Blob,
  source: string,
  options: DocumentImportRequestOptions = {},
): Promise<LbrnImportResult> | null {
  return request({ kind: 'lightburn-project', blob, source }, 'lightburn-project', options);
}

export function parseMaterialLibraryOffThread(
  blob: Blob,
  options: DocumentImportRequestOptions = {},
): Promise<DeserializeMaterialLibraryResult> | null {
  return request({ kind: 'material-library', blob }, 'material-library', options);
}

export function parseLightBurnClbOffThread(
  blob: Blob,
  source: string,
  options: DocumentImportRequestOptions = {},
): Promise<ClbImportResult> | null {
  return request({ kind: 'lightburn-clb', blob, source }, 'lightburn-clb', options);
}

export function resetDocumentImportWorkerForTests(): void {
  rejectAllPending('document import worker reset');
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<DocumentImportWorkerRequest, 'id'>;

function request<R>(
  body: RequestBody,
  expectedKind: ResultKind,
  options: DocumentImportRequestOptions,
): Promise<R> | null {
  if (ensureWorker() === null) return null;
  if (options.signal?.aborted === true) return Promise.reject(abortError());
  nextRequestId += 1;
  const id = nextRequestId;
  return new Promise<R>((resolve, reject) => {
    const handleAbort = (): void => cancelRequest(id);
    pendingById.set(id, {
      request: { id, ...body } as DocumentImportWorkerRequest,
      expectedKind,
      resolve: (response) => resolveResult(response, expectedKind, resolve, reject),
      reject,
      options,
      handleAbort,
    });
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    queue.push(id);
    reportQueue();
    startNext();
  });
}

function resolveResult<R>(
  response: DocumentImportWorkerResponse,
  expectedKind: ResultKind,
  resolve: (result: R) => void,
  reject: (error: Error) => void,
): void {
  if (response.kind === 'error') reject(new Error(response.message));
  else if (response.kind === 'progress') reject(new Error('progress is not a final response'));
  else if (response.kind !== expectedKind) {
    reject(new Error(`document worker answered '${response.kind}' for '${expectedKind}'`));
  } else resolve(response.result as R);
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
    pending.reject(new Error('document import worker unavailable'));
    finish(id);
    return;
  }
  activeRequestId = id;
  try {
    worker.postMessage(pending.request);
  } catch (error) {
    pending.reject(error instanceof Error ? error : new Error(String(error)));
    retireWorker();
    finish(id);
  }
  reportQueue();
}

function handleMessage(event: MessageEvent<DocumentImportWorkerResponse>): void {
  const pending = pendingById.get(event.data.id);
  if (pending === undefined) return;
  if (event.data.kind === 'progress') {
    pending.options.onProgress?.({ phase: event.data.phase, queuePosition: 0 });
    return;
  }
  pending.resolve(event.data);
  finish(event.data.id);
}

function finish(id: number): void {
  const pending = pendingById.get(id);
  pending?.options.signal?.removeEventListener('abort', pending.handleAbort);
  pendingById.delete(id);
  if (activeRequestId === id) activeRequestId = null;
  reportQueue();
  startNext();
}

function cancelRequest(id: number): void {
  const pending = pendingById.get(id);
  if (pending === undefined) return;
  pending.reject(abortError());
  if (activeRequestId === id) {
    retireWorker();
    activeRequestId = null;
  } else {
    const index = queue.indexOf(id);
    if (index >= 0) queue.splice(index, 1);
  }
  finish(id);
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
    const worker = new Worker(new URL('./document-import-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance = worker;
    worker.onmessage = (event) => {
      if (workerInstance === worker) handleMessage(event);
    };
    worker.onerror = () => {
      if (workerInstance === worker) rejectAllPending('document import worker errored');
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
  const error = new Error('document import request cancelled');
  error.name = 'AbortError';
  return error;
}
