// Deep import: core/relief's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import type {
  HeightfieldHeightmapOptions,
  HeightfieldHeightmapResult,
} from '../../core/relief/heightfield-to-heightmap';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { ReliefHeightfield } from '../../core/scene/relief';
import type { RemovalGrid } from '../../core/sim';
import {
  connectCanvasCompilationMainBridge,
  retireCanvasCompilationMainBridge,
} from './canvas-compilation-main-bridge';
import {
  CncRemovalGridSupersededError,
  type MainPending,
  type MainRequest,
} from './cnc-preview-worker-client-types';
import { createReliefPreviewQueue, type ReliefPreviewQueue } from './cnc-relief-preview-queue';
import type {
  CncRemovalGridWorkerRequest,
  CncRemovalGridWorkerResponse,
  ReliefHeightmapWorkerItem,
  ReliefHeightmapWorkerResult,
} from './cnc-removal-grid-worker-protocol';

type MainResult = RemovalGrid | ReliefSurfaceMeshWithNormals | null;

type GridRequest = Omit<
  Extract<CncRemovalGridWorkerRequest, { readonly kind: 'grid' }>,
  'id' | 'kind'
>;

/** Stateful worker operations exposed by one isolated CNC preview client instance. */
export type CncPreviewWorkerClient = {
  readonly prepareGrid: (
    request: GridRequest,
    signal?: AbortSignal,
  ) => Promise<RemovalGrid | null> | null;
  readonly prepareSurface: (
    grid: RemovalGrid,
    signal?: AbortSignal,
  ) => Promise<ReliefSurfaceMeshWithNormals> | null;
  readonly prepareReliefBatch: (
    items: ReadonlyArray<ReliefHeightmapWorkerItem>,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<ReliefHeightmapWorkerResult>> | null;
  readonly prepareRelief: (
    source: ReliefHeightfield,
    options: HeightfieldHeightmapOptions,
    signal?: AbortSignal,
  ) => Promise<HeightfieldHeightmapResult> | null;
  readonly resetForTests: () => void;
};

/** Create an isolated CNC preview worker client with instance-local mutable ownership. */
export function createCncPreviewWorkerClient(): CncPreviewWorkerClient {
  return new CncPreviewWorkerClientRuntime();
}

class CncPreviewWorkerClientRuntime implements CncPreviewWorkerClient {
  private workerInstance: Worker | null = null;
  private mainPending: MainPending | null = null;
  private mainQueued: { readonly request: MainRequest; readonly pending: MainPending } | null =
    null;
  private nextRequestId = 0;
  private readonly reliefQueue: ReliefPreviewQueue;

  constructor() {
    this.reliefQueue = createReliefPreviewQueue({
      ensureWorker: () => this.ensureWorker(),
      currentWorker: () => this.workerInstance,
      failWorker: (worker, error) => this.failWorker(worker, error),
      canStart: () => this.mainPending === null,
    });
  }

  prepareGrid(request: GridRequest, signal?: AbortSignal): Promise<RemovalGrid | null> | null {
    if (signal?.aborted === true) return Promise.reject(abortError());
    return this.submitMain({ id: this.nextId(), kind: 'grid', ...request }, signal);
  }

  prepareSurface(
    grid: RemovalGrid,
    signal?: AbortSignal,
  ): Promise<ReliefSurfaceMeshWithNormals> | null {
    if (signal?.aborted === true) return Promise.reject(abortError());
    return this.submitMain({ id: this.nextId(), kind: 'surface', grid }, signal);
  }

  prepareReliefBatch(
    items: ReadonlyArray<ReliefHeightmapWorkerItem>,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ReliefHeightmapWorkerResult>> | null {
    if (items.length === 0) return Promise.resolve([]);
    return this.reliefQueue.submit(this.nextId(), items, signal);
  }

  prepareRelief(
    source: ReliefHeightfield,
    options: HeightfieldHeightmapOptions,
    signal?: AbortSignal,
  ): Promise<HeightfieldHeightmapResult> | null {
    const batch = this.prepareReliefBatch([{ taskId: 'relief', source, options }], signal);
    if (batch === null) return null;
    return batch.then((items) => {
      const item = items[0];
      if (items.length !== 1 || item?.taskId !== 'relief') {
        throw new Error('Relief preview worker returned an unbound result');
      }
      return item.result;
    });
  }

  resetForTests(): void {
    this.dropQueuedMain(new CncRemovalGridSupersededError());
    this.supersede(new CncRemovalGridSupersededError());
    this.retireWorker();
    this.nextRequestId = 0;
  }

  private submitMain(
    request: Extract<MainRequest, { readonly kind: 'grid' }>,
    signal?: AbortSignal,
  ): Promise<RemovalGrid | null> | null;
  private submitMain(
    request: Extract<MainRequest, { readonly kind: 'surface' }>,
    signal?: AbortSignal,
  ): Promise<ReliefSurfaceMeshWithNormals> | null;
  private submitMain(request: MainRequest, signal?: AbortSignal): Promise<MainResult> | null {
    // A grid and a surface feed each other while playback runs (ADR-425).
    // Killing the running one for the other meant a slow machine finished
    // neither, so the other kind waits its turn. Same kind is still latest-only.
    const active = this.mainPending;
    if (active !== null && active.kind !== request.kind) {
      return new Promise<MainResult>((resolve, reject) => {
        this.queueMain(request, mainPendingFor(request, resolve, reject, signal));
      });
    }
    this.supersede(new CncRemovalGridSupersededError());
    const worker = this.ensureWorker();
    if (worker === null) return null;
    return new Promise<MainResult>((resolve, reject) => {
      this.startMain(worker, request, mainPendingFor(request, resolve, reject, signal));
    });
  }

  private queueMain(request: MainRequest, pending: MainPending): void {
    this.dropQueuedMain(new CncRemovalGridSupersededError());
    const signal = pending.signal;
    if (signal === undefined) {
      this.mainQueued = { request, pending };
      return;
    }
    const abortListener = (): void => {
      if (this.mainQueued?.pending.id !== pending.id) return;
      this.dropQueuedMain(abortError());
    };
    signal.addEventListener('abort', abortListener, { once: true });
    this.mainQueued = { request, pending: { ...pending, abortListener } };
  }

  private dropQueuedMain(error: Error): void {
    const queued = this.mainQueued;
    if (queued === null) return;
    this.mainQueued = null;
    detachMainAbort(queued.pending);
    queued.pending.reject(error);
  }

  private startQueuedMain(): void {
    const queued = this.mainQueued;
    if (queued === null || this.mainPending !== null) return;
    this.mainQueued = null;
    detachMainAbort(queued.pending);
    const worker = this.ensureWorker();
    if (worker === null) {
      queued.pending.reject(new Error('CNC preview worker is unavailable'));
      return;
    }
    this.startMain(worker, queued.request, queued.pending);
  }

  private startMain(worker: Worker, request: MainRequest, pending: MainPending): void {
    this.bindMain(pending);
    try {
      worker.postMessage(request);
    } catch (error) {
      this.failWorker(worker, asError(error));
    }
  }

  private bindMain(active: MainPending): void {
    if (active.signal === undefined) {
      this.mainPending = active;
      return;
    }
    const abortListener = (): void => this.abortMain(active.id);
    const bound: MainPending = { ...active, abortListener };
    active.signal.addEventListener('abort', abortListener, { once: true });
    this.mainPending = bound;
  }

  private nextId(): number {
    this.nextRequestId += 1;
    return this.nextRequestId;
  }

  private ensureWorker(): Worker | null {
    if (this.workerInstance !== null) return this.workerInstance;
    if (typeof Worker === 'undefined') return null;
    try {
      const created = new Worker(new URL('./cnc-removal-grid-worker.ts', import.meta.url), {
        type: 'module',
      });
      connectCanvasCompilationMainBridge(created);
      created.onmessage = (event: MessageEvent<CncRemovalGridWorkerResponse>) => {
        if (this.workerInstance === created) this.handleMessage(event.data);
      };
      created.onerror = () => this.failWorker(created, new Error('CNC preview worker errored'));
      created.onmessageerror = () =>
        this.failWorker(created, new Error('CNC preview response was not cloneable'));
      this.workerInstance = created;
      return created;
    } catch {
      return null;
    }
  }

  private handleMessage(response: CncRemovalGridWorkerResponse): void {
    if (this.reliefQueue.handleResponse(response)) return;
    const active = this.mainPending;
    if (active === null || active.id !== response.id) return;
    this.mainPending = null;
    detachMainAbort(active);
    if (response.kind === 'error') active.reject(new Error(response.message));
    else if (active.kind === 'grid' && response.kind === 'grid') active.resolve(response.grid);
    else if (active.kind === 'surface' && response.kind === 'surface') {
      active.resolve(response.surface);
    } else active.reject(new Error('CNC preview worker returned a mismatched response'));
    this.startQueuedMain();
    this.reliefQueue.pump();
  }

  private failWorker(worker: Worker, error: Error): void {
    if (this.workerInstance !== worker) return;
    const active = this.mainPending;
    this.mainPending = null;
    if (active !== null) detachMainAbort(active);
    this.reliefQueue.failActive(error);
    this.retireWorker();
    active?.reject(error);
    this.startQueuedMain();
    this.reliefQueue.pump();
  }

  private abortMain(id: number): void {
    const active = this.mainPending;
    if (active === null || active.id !== id) return;
    this.mainPending = null;
    detachMainAbort(active);
    this.retireWorker();
    active.reject(abortError());
    this.startQueuedMain();
    this.reliefQueue.pump();
  }

  private supersede(error: Error): void {
    const active = this.mainPending;
    this.mainPending = null;
    if (active !== null) detachMainAbort(active);
    active?.reject(error);
    const hadReliefs = this.reliefQueue.cancelAll(error);
    if (active !== null || hadReliefs) this.retireWorker();
  }

  private retireWorker(): void {
    if (this.workerInstance === null) return;
    const retired = this.workerInstance;
    this.workerInstance = null;
    retireCanvasCompilationMainBridge(retired);
    retired.terminate();
  }
}

function detachMainAbort(active: MainPending): void {
  if (active.abortListener === undefined) return;
  active.signal?.removeEventListener('abort', active.abortListener);
}

function abortError(): Error {
  const error = new Error('CNC preview preparation aborted');
  error.name = 'AbortError';
  return error;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function mainPendingFor(
  request: MainRequest,
  resolve: (value: MainResult) => void,
  reject: (error: Error) => void,
  signal: AbortSignal | undefined,
): MainPending {
  const cancellation = signal === undefined ? {} : { signal };
  return request.kind === 'grid'
    ? { id: request.id, kind: 'grid', resolve, reject, ...cancellation }
    : { id: request.id, kind: 'surface', resolve, reject, ...cancellation };
}
