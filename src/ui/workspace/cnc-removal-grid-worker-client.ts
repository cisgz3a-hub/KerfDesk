import type {
  DepthMapHeightmapOptions,
  DepthMapHeightmapResult,
} from '../../core/relief/depth-map-to-heightmap';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { ReliefObject } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import {
  connectCanvasCompilationMainBridge,
  retireCanvasCompilationMainBridge,
} from './canvas-compilation-main-bridge';
import type {
  CncRemovalGridWorkerRequest,
  CncRemovalGridWorkerResponse,
  ReliefHeightmapWorkerItem,
  ReliefHeightmapWorkerResult,
} from './cnc-removal-grid-worker-protocol';
import {
  CncRemovalGridSupersededError,
  type MainPending,
  type MainRequest,
  type ReliefPending,
} from './cnc-preview-worker-client-types';
export { isCncRemovalGridSuperseded } from './cnc-preview-worker-client-types';

type ReliefDepthMap = NonNullable<ReliefObject['depthMap']>;

let workerInstance: Worker | null = null;
let mainPending: MainPending | null = null;
const reliefPending = new Map<number, ReliefPending>();
const reliefQueue: number[] = [];
let activeReliefId: number | null = null;
let nextRequestId = 0;

export function prepareCncRemovalGridOffThread(
  request: Omit<Extract<CncRemovalGridWorkerRequest, { readonly kind: 'grid' }>, 'id' | 'kind'>,
  signal?: AbortSignal,
): Promise<RemovalGrid | null> | null {
  if (signal?.aborted === true) return Promise.reject(abortError());
  supersedeForMainRequest();
  return submitMain({ id: nextId(), kind: 'grid', ...request }, signal);
}

export function prepareCncCut3DSurfaceOffThread(
  grid: RemovalGrid,
  signal?: AbortSignal,
): Promise<ReliefSurfaceMeshWithNormals> | null {
  if (signal?.aborted === true) return Promise.reject(abortError());
  supersedeForMainRequest();
  return submitMain({ id: nextId(), kind: 'surface', grid }, signal);
}

export function prepareReliefHeightmapsOffThread(
  items: ReadonlyArray<ReliefHeightmapWorkerItem>,
  signal?: AbortSignal,
): Promise<ReadonlyArray<ReliefHeightmapWorkerResult>> | null {
  if (items.length === 0) return Promise.resolve([]);
  if (signal?.aborted === true) return Promise.reject(abortError());
  const worker = ensureWorker();
  if (worker === null) return null;
  const request = { id: nextId(), kind: 'relief-heightmaps' as const, items };
  return new Promise((resolve, reject) => {
    const active: ReliefPending = {
      id: request.id,
      request,
      resolve,
      reject,
      ...(signal === undefined ? {} : { signal }),
    };
    if (signal !== undefined) {
      active.abortListener = () => abortRelief(active);
      signal.addEventListener('abort', active.abortListener, { once: true });
    }
    reliefPending.set(active.id, active);
    reliefQueue.push(active.id);
    pumpReliefQueue();
  });
}

export function prepareReliefHeightmapOffThread(
  source: ReliefDepthMap,
  options: DepthMapHeightmapOptions,
  signal?: AbortSignal,
): Promise<DepthMapHeightmapResult> | null {
  const batch = prepareReliefHeightmapsOffThread([{ taskId: 'relief', source, options }], signal);
  if (batch === null) return null;
  return batch.then((items) => {
    const item = items[0];
    if (items.length !== 1 || item?.taskId !== 'relief') {
      throw new Error('Relief preview worker returned an unbound result');
    }
    return item.result;
  });
}

export function resetCncRemovalGridWorkerForTests(): void {
  supersedeAll();
  retireWorker();
  nextRequestId = 0;
}

function submitMain(
  request: Extract<MainRequest, { readonly kind: 'grid' }>,
  signal?: AbortSignal,
): Promise<RemovalGrid | null> | null;
function submitMain(
  request: Extract<MainRequest, { readonly kind: 'surface' }>,
  signal?: AbortSignal,
): Promise<ReliefSurfaceMeshWithNormals> | null;
function submitMain(
  request: MainRequest,
  signal?: AbortSignal,
): Promise<RemovalGrid | ReliefSurfaceMeshWithNormals | null> | null {
  const worker = ensureWorker();
  if (worker === null) return null;
  if (request.kind === 'grid') {
    return postMain<RemovalGrid | null>(worker, request, (resolve, reject) => {
      bindMain({
        id: request.id,
        kind: request.kind,
        resolve,
        reject,
        ...(signal === undefined ? {} : { signal }),
      });
    });
  }
  return postMain<ReliefSurfaceMeshWithNormals>(worker, request, (resolve, reject) => {
    bindMain({
      id: request.id,
      kind: request.kind,
      resolve,
      reject,
      ...(signal === undefined ? {} : { signal }),
    });
  });
}

function bindMain(active: MainPending): void {
  if (active.signal !== undefined) {
    active.abortListener = () => abortMain(active);
    active.signal.addEventListener('abort', active.abortListener, { once: true });
  }
  mainPending = active;
}

function postMain<T>(
  worker: Worker,
  request: MainRequest,
  bind: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    bind(resolve, reject);
    try {
      worker.postMessage(request);
    } catch (error) {
      failWorker(worker, asError(error));
    }
  });
}

function nextId(): number {
  nextRequestId += 1;
  return nextRequestId;
}

function ensureWorker(): Worker | null {
  if (workerInstance !== null) return workerInstance;
  if (typeof Worker === 'undefined') return null;
  try {
    const created = new Worker(new URL('./cnc-removal-grid-worker.ts', import.meta.url), {
      type: 'module',
    });
    connectCanvasCompilationMainBridge(created);
    created.onmessage = (event: MessageEvent<CncRemovalGridWorkerResponse>) => {
      if (workerInstance === created) handleMessage(event.data);
    };
    created.onerror = () => failWorker(created, new Error('CNC preview worker errored'));
    created.onmessageerror = () =>
      failWorker(created, new Error('CNC preview response was not cloneable'));
    workerInstance = created;
    return created;
  } catch {
    return null;
  }
}

function handleMessage(response: CncRemovalGridWorkerResponse): void {
  if (response.id === activeReliefId) {
    const relief = reliefPending.get(response.id);
    activeReliefId = null;
    reliefPending.delete(response.id);
    if (relief !== undefined) {
      detachAbort(relief);
      if (response.kind === 'relief-heightmaps') relief.resolve(response.items);
      else
        relief.reject(
          new Error(response.kind === 'error' ? response.message : 'Mismatched relief response'),
        );
    }
    pumpReliefQueue();
    return;
  }
  const active = mainPending;
  if (active === null || active.id !== response.id) return;
  mainPending = null;
  detachMainAbort(active);
  if (response.kind === 'error') active.reject(new Error(response.message));
  else if (active.kind === 'grid' && response.kind === 'grid') active.resolve(response.grid);
  else if (active.kind === 'surface' && response.kind === 'surface')
    active.resolve(response.surface);
  else active.reject(new Error('CNC preview worker returned a mismatched response'));
  pumpReliefQueue();
}

function abortRelief(active: ReliefPending): void {
  if (reliefPending.get(active.id) !== active) return;
  reliefPending.delete(active.id);
  detachAbort(active);
  if (activeReliefId === active.id) {
    try {
      workerInstance?.postMessage({ id: active.id, kind: 'cancel-relief' });
    } catch (error) {
      if (workerInstance !== null) failWorker(workerInstance, asError(error));
    }
  }
  active.reject(abortError());
  pumpReliefQueue();
}

function failWorker(worker: Worker, error: Error): void {
  if (workerInstance !== worker) return;
  const activeMain = mainPending;
  mainPending = null;
  if (activeMain !== null) detachMainAbort(activeMain);
  const activeRelief = activeReliefId === null ? undefined : reliefPending.get(activeReliefId);
  if (activeRelief !== undefined) {
    reliefPending.delete(activeRelief.id);
    detachAbort(activeRelief);
  }
  activeReliefId = null;
  retireWorker();
  activeMain?.reject(error);
  activeRelief?.reject(error);
  pumpReliefQueue();
}

function abortMain(active: MainPending): void {
  if (mainPending !== active) return;
  mainPending = null;
  detachMainAbort(active);
  retireWorker();
  active.reject(abortError());
  pumpReliefQueue();
}

function supersedeForMainRequest(): void {
  const active = mainPending;
  const hadReliefs = activeReliefId !== null || reliefPending.size > 0;
  mainPending = null;
  activeReliefId = null;
  reliefQueue.length = 0;
  const error = new CncRemovalGridSupersededError();
  if (active !== null) detachMainAbort(active);
  active?.reject(error);
  rejectAllReliefs(error);
  if (active !== null || hadReliefs) retireWorker();
}

function supersedeAll(): void {
  const error = new CncRemovalGridSupersededError();
  const active = mainPending;
  mainPending = null;
  if (active !== null) detachMainAbort(active);
  active?.reject(error);
  const hadReliefs = activeReliefId !== null || reliefPending.size > 0;
  activeReliefId = null;
  reliefQueue.length = 0;
  rejectAllReliefs(error);
  if (active !== null || hadReliefs) retireWorker();
}

function rejectAllReliefs(error: Error): void {
  for (const active of reliefPending.values()) {
    detachAbort(active);
    active.reject(error);
  }
  reliefPending.clear();
}

function pumpReliefQueue(): void {
  if (mainPending !== null || activeReliefId !== null) return;
  while (reliefQueue.length > 0) {
    const id = reliefQueue.shift();
    if (id === undefined) return;
    const active = reliefPending.get(id);
    if (active === undefined) continue;
    const worker = ensureWorker();
    if (worker === null) {
      reliefPending.delete(id);
      detachAbort(active);
      active.reject(new Error('Relief preview worker is unavailable'));
      continue;
    }
    activeReliefId = id;
    try {
      worker.postMessage(active.request);
    } catch (error) {
      failWorker(worker, asError(error));
    }
    return;
  }
}

function detachAbort(active: ReliefPending): void {
  if (active.abortListener === undefined) return;
  active.signal?.removeEventListener('abort', active.abortListener);
  delete active.abortListener;
}

function detachMainAbort(active: MainPending): void {
  if (active.abortListener === undefined) return;
  active.signal?.removeEventListener('abort', active.abortListener);
  delete active.abortListener;
}

function retireWorker(): void {
  if (workerInstance === null) return;
  const retired = workerInstance;
  workerInstance = null;
  retireCanvasCompilationMainBridge(retired);
  retired.terminate();
}

function abortError(): Error {
  const error = new Error('relief preview preparation aborted');
  error.name = 'AbortError';
  return error;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
