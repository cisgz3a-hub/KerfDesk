import type { ParseDxfResult } from '../../io/dxf';
import type { ParseGcodeProgramResult } from '../../io/gcode';
import type { ImportWorkerRequest, ImportWorkerResponse } from './import-worker-protocol';
import type {
  PreparedStlImportResult,
  StlImportPreparationOptions,
} from './stl-import-preparation';
import { type PackedDxfResult, unpackDxfResult } from './packed-dxf-result';
import { type PackedGcodeResult, unpackGcodeResult } from './packed-gcode-result';

export type ImportWorkerProgress = {
  readonly phase: 'queued' | 'reading' | 'parsing' | 'preparing';
  readonly queuePosition: number;
  readonly bytesRead?: number;
  readonly totalBytes?: number;
};

export type ImportWorkerRequestOptions = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ImportWorkerProgress) => void;
};

type Pending = {
  readonly request: ImportWorkerRequest;
  readonly expectedKind: Exclude<ImportWorkerResponse['kind'], 'progress' | 'error'>;
  readonly resolve: (response: ImportWorkerResponse) => void;
  readonly reject: (error: Error) => void;
  readonly options: ImportWorkerRequestOptions;
  readonly handleAbort: () => void;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
let activeRequestId: number | null = null;
const pendingByRequestId = new Map<number, Pending>();
const requestQueue: number[] = [];

export function parseDxfOffThread(
  blob: Blob,
  objectId: string,
  source: string,
  options: ImportWorkerRequestOptions = {},
): Promise<ParseDxfResult> | null {
  const packed = request<'dxf', PackedDxfResult>(
    { kind: 'dxf', blob, objectId, source },
    'dxf',
    options,
  );
  return packed === null ? null : packed.then(unpackDxfResult);
}

export function parseGcodeOffThread(
  blob: Blob,
  options: ImportWorkerRequestOptions = {},
): Promise<ParseGcodeProgramResult> | null {
  const packed = request<'gcode', PackedGcodeResult>({ kind: 'gcode', blob }, 'gcode', options);
  return packed === null ? null : packed.then(unpackGcodeResult);
}

export function parseStlOffThread(
  blob: Blob,
  preparation: StlImportPreparationOptions,
  options: ImportWorkerRequestOptions = {},
): Promise<PreparedStlImportResult> | null {
  return request({ kind: 'stl', blob, options: preparation }, 'stl', options);
}

export function resetImportWorkerForTests(): void {
  rejectAllPendingAndRetireWorker('import worker reset');
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<ImportWorkerRequest, 'id'>;
type ResultKind = Pending['expectedKind'];

function request<K extends ResultKind, R>(
  body: RequestBody,
  expectedKind: K,
  options: ImportWorkerRequestOptions,
): Promise<R> | null {
  if (options.signal?.aborted === true) return Promise.reject(abortError());
  if (ensureWorker() === null) return null;
  nextRequestId += 1;
  const id = nextRequestId;
  return new Promise<R>((resolve, reject) => {
    const handleAbort = (): void => cancelRequest(id);
    pendingByRequestId.set(id, {
      request: { id, ...body } as ImportWorkerRequest,
      expectedKind,
      resolve: (response) => resolveResult(response, expectedKind, resolve, reject),
      reject,
      options,
      handleAbort,
    });
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    requestQueue.push(id);
    reportQueuePositions();
    startNextRequest();
  });
}

function resolveResult<R>(
  response: ImportWorkerResponse,
  expectedKind: ResultKind,
  resolve: (result: R) => void,
  reject: (error: Error) => void,
): void {
  if (response.kind === 'error') reject(new Error(response.message));
  else if (response.kind === 'progress') reject(new Error('progress is not a final response'));
  else if (response.kind !== expectedKind) {
    reject(new Error(`import worker answered '${response.kind}' for a '${expectedKind}' request`));
  } else resolve(response.result as R);
}

function startNextRequest(): void {
  if (activeRequestId !== null) return;
  const id = requestQueue.shift();
  if (id === undefined) return;
  const pending = pendingByRequestId.get(id);
  if (pending === undefined) {
    startNextRequest();
    return;
  }
  const worker = ensureWorker();
  if (worker === null) {
    pending.reject(new Error('import worker unavailable'));
    finishRequest(id);
    return;
  }
  activeRequestId = id;
  try {
    worker.postMessage(pending.request);
  } catch (error) {
    pending.reject(error instanceof Error ? error : new Error(String(error)));
    retireWorker();
    finishRequest(id);
  }
  reportQueuePositions();
}

function handleWorkerMessage(event: MessageEvent<ImportWorkerResponse>): void {
  const pending = pendingByRequestId.get(event.data.id);
  if (pending === undefined) return;
  if (event.data.kind === 'progress') {
    pending.options.onProgress?.({
      phase: event.data.phase,
      queuePosition: 0,
      ...(event.data.bytesRead === undefined ? {} : { bytesRead: event.data.bytesRead }),
      ...(event.data.totalBytes === undefined ? {} : { totalBytes: event.data.totalBytes }),
    });
    return;
  }
  pending.resolve(event.data);
  finishRequest(event.data.id);
}

function finishRequest(id: number): void {
  const pending = pendingByRequestId.get(id);
  pending?.options.signal?.removeEventListener('abort', pending.handleAbort);
  pendingByRequestId.delete(id);
  if (activeRequestId === id) activeRequestId = null;
  reportQueuePositions();
  startNextRequest();
}

function cancelRequest(id: number): void {
  const pending = pendingByRequestId.get(id);
  if (pending === undefined) return;
  pending.reject(abortError());
  if (activeRequestId === id) {
    retireWorker();
    activeRequestId = null;
  } else {
    const index = requestQueue.indexOf(id);
    if (index >= 0) requestQueue.splice(index, 1);
  }
  finishRequest(id);
}

function reportQueuePositions(): void {
  for (const [index, id] of requestQueue.entries()) {
    pendingByRequestId.get(id)?.options.onProgress?.({
      phase: 'queued',
      queuePosition: index + 1,
    });
  }
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('./import-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance = worker;
    worker.onmessage = (event) => {
      if (workerInstance === worker) handleWorkerMessage(event);
    };
    worker.onerror = () => {
      if (workerInstance === worker) {
        rejectAllPendingAndRetireWorker('import worker errored');
      }
    };
    return worker;
  } catch {
    return null;
  }
}

function rejectAllPendingAndRetireWorker(message: string): void {
  const pending = Array.from(pendingByRequestId.values());
  pendingByRequestId.clear();
  requestQueue.splice(0);
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
  const error = new Error('import request cancelled');
  error.name = 'AbortError';
  return error;
}
