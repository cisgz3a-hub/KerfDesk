import type { ReliefPending } from './cnc-preview-worker-client-types';
import type {
  CncRemovalGridWorkerResponse,
  ReliefHeightmapWorkerItem,
  ReliefHeightmapWorkerResult,
} from './cnc-removal-grid-worker-protocol';

type ReliefPreviewQueueHost = {
  readonly ensureWorker: () => Worker | null;
  readonly currentWorker: () => Worker | null;
  readonly failWorker: (worker: Worker, error: Error) => void;
  readonly canStart: () => boolean;
};

/** Queue contract that serializes cancellable relief batches behind latest-only preview work. */
export type ReliefPreviewQueue = {
  readonly submit: (
    id: number,
    items: ReadonlyArray<ReliefHeightmapWorkerItem>,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<ReliefHeightmapWorkerResult>> | null;
  readonly handleResponse: (response: CncRemovalGridWorkerResponse) => boolean;
  readonly failActive: (error: Error) => void;
  readonly cancelAll: (error: Error) => boolean;
  readonly hasWork: () => boolean;
  readonly pump: () => void;
};

/** Create one isolated relief queue bound to a shared preview-worker host. */
export function createReliefPreviewQueue(host: ReliefPreviewQueueHost): ReliefPreviewQueue {
  return new ReliefPreviewQueueRuntime(host);
}

class ReliefPreviewQueueRuntime implements ReliefPreviewQueue {
  private readonly pending = new Map<number, ReliefPending>();
  private readonly queuedIds: number[] = [];
  private activeId: number | null = null;

  constructor(private readonly host: ReliefPreviewQueueHost) {}

  submit(
    id: number,
    items: ReadonlyArray<ReliefHeightmapWorkerItem>,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<ReliefHeightmapWorkerResult>> | null {
    if (items.length === 0) return Promise.resolve([]);
    if (signal?.aborted === true) return Promise.reject(abortError());
    if (this.host.ensureWorker() === null) return null;
    return new Promise((resolve, reject) => {
      const abortListener = (): void => this.abort(id);
      const active: ReliefPending = {
        id,
        request: { id, kind: 'relief-heightmaps', items },
        resolve,
        reject,
        ...(signal === undefined ? {} : { signal, abortListener }),
      };
      signal?.addEventListener('abort', abortListener, { once: true });
      this.pending.set(id, active);
      this.queuedIds.push(id);
      this.pump();
    });
  }

  handleResponse(response: CncRemovalGridWorkerResponse): boolean {
    if (response.id !== this.activeId) return false;
    const active = this.pending.get(response.id);
    this.activeId = null;
    this.pending.delete(response.id);
    if (active !== undefined) {
      detachAbort(active);
      if (response.kind === 'relief-heightmaps') active.resolve(response.items);
      else active.reject(responseError(response));
    }
    this.pump();
    return true;
  }

  failActive(error: Error): void {
    const active = this.activeId === null ? undefined : this.pending.get(this.activeId);
    if (active !== undefined) {
      this.pending.delete(active.id);
      detachAbort(active);
    }
    this.activeId = null;
    active?.reject(error);
  }

  cancelAll(error: Error): boolean {
    const hadWork = this.hasWork();
    this.activeId = null;
    this.queuedIds.length = 0;
    for (const active of this.pending.values()) {
      detachAbort(active);
      active.reject(error);
    }
    this.pending.clear();
    return hadWork;
  }

  hasWork(): boolean {
    return this.activeId !== null || this.pending.size > 0;
  }

  pump(): void {
    if (!this.host.canStart() || this.activeId !== null) return;
    while (this.queuedIds.length > 0) {
      const id = this.queuedIds.shift();
      if (id === undefined) return;
      const active = this.pending.get(id);
      if (active === undefined) continue;
      if (this.post(active)) return;
    }
  }

  private post(active: ReliefPending): boolean {
    const worker = this.host.ensureWorker();
    if (worker === null) {
      this.pending.delete(active.id);
      detachAbort(active);
      active.reject(new Error('Relief preview worker is unavailable'));
      return false;
    }
    this.activeId = active.id;
    try {
      worker.postMessage(active.request);
    } catch (error) {
      this.host.failWorker(worker, asError(error));
    }
    return true;
  }

  private abort(id: number): void {
    const active = this.pending.get(id);
    if (active === undefined) return;
    this.pending.delete(id);
    detachAbort(active);
    if (this.activeId === id) this.postCancellation(id);
    active.reject(abortError());
    this.pump();
  }

  private postCancellation(id: number): void {
    const worker = this.host.currentWorker();
    try {
      worker?.postMessage({ id, kind: 'cancel-relief' });
    } catch (error) {
      if (worker !== null) this.host.failWorker(worker, asError(error));
    }
  }
}

function responseError(response: CncRemovalGridWorkerResponse): Error {
  return new Error(response.kind === 'error' ? response.message : 'Mismatched relief response');
}

function detachAbort(active: ReliefPending): void {
  if (active.abortListener === undefined) return;
  active.signal?.removeEventListener('abort', active.abortListener);
}

function abortError(): Error {
  const error = new Error('relief preview preparation aborted');
  error.name = 'AbortError';
  return error;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
