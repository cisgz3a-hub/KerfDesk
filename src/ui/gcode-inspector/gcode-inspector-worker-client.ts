import type { GcodeInspectionSource } from './gcode-inspection-source';
import type {
  GcodeInspectorWorkerRequest,
  GcodeInspectorWorkerResponse,
  GcodeInspectorWorkerResult,
} from './gcode-inspector-worker-protocol';

export type GcodeInspectorProgress = {
  readonly phase: 'queued' | 'reading' | 'parsing';
  readonly queuePosition: number;
  readonly bytesRead?: number;
  readonly totalBytes?: number;
};

export type GcodeInspectorRequestOptions = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: GcodeInspectorProgress) => void;
};

type Pending = {
  readonly request: GcodeInspectorWorkerRequest;
  readonly resolve: (result: GcodeInspectorWorkerResult) => void;
  readonly reject: (error: Error) => void;
  readonly options: GcodeInspectorRequestOptions;
  readonly handleAbort: () => void;
};

let workerInstance: Worker | null = null;
let nextRequestId = 0;
let activeRequestId: number | null = null;
const pendingByRequestId = new Map<number, Pending>();
const requestQueue: number[] = [];

export function inspectGcodeOffThread(
  source: GcodeInspectionSource,
  options: GcodeInspectorRequestOptions = {},
): Promise<GcodeInspectorWorkerResult> | null {
  if (options.signal?.aborted === true) return Promise.reject(abortError());
  if (ensureWorker() === null) return null;
  nextRequestId += 1;
  const id = nextRequestId;
  return new Promise((resolve, reject) => {
    const handleAbort = (): void => cancelRequest(id);
    pendingByRequestId.set(id, {
      request: { id, source },
      resolve,
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

export function resetGcodeInspectorWorkerForTests(): void {
  rejectAllPending('G-code Inspector worker reset');
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
    pending.reject(new Error('G-code Inspector worker unavailable'));
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

function handleMessage(event: MessageEvent<GcodeInspectorWorkerResponse>): void {
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
  if (event.data.kind === 'error') pending.reject(new Error(event.data.message));
  else pending.resolve(event.data.result);
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
    const worker = new Worker(new URL('./gcode-inspector-worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance = worker;
    worker.onmessage = (event) => {
      if (workerInstance === worker) handleMessage(event);
    };
    worker.onerror = () => {
      if (workerInstance === worker) rejectAllPending('G-code Inspector worker errored');
    };
    return worker;
  } catch {
    return null;
  }
}

function rejectAllPending(message: string): void {
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
  const error = new Error('G-code Inspector request cancelled');
  error.name = 'AbortError';
  return error;
}
