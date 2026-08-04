import { BoundedCompilationWorkerPool } from './bounded-compilation-worker-pool';
import {
  BOUNDED_COMPILATION_BRIDGE_CHANNEL,
  parseBoundedCompilationBridgeRequest,
  type BoundedCompilationBridgePort,
  type BoundedCompilationBridgeResponse,
} from './bounded-compilation-bridge-protocol';
import { BoundedCompilationSerialWorker } from './bounded-compilation-serial-worker';
import type {
  BoundedCompilationId,
  BoundedCompilationWorkerLike,
} from './bounded-compilation-worker-pool-protocol';

type ActiveRequest = {
  readonly requestId: number;
  readonly externalJobId: BoundedCompilationId;
  readonly controller: AbortController;
};

type SourceState = {
  readonly sourceId: number;
  readonly port: BoundedCompilationBridgePort;
  readonly active: Map<number, ActiveRequest>;
  detached: boolean;
};

export type BoundedCompilationMainBridgeOptions<TPayload> = {
  readonly concurrency: number;
  readonly maxSources: number;
  readonly maxActiveJobs: number;
  readonly createWorker: () => BoundedCompilationWorkerLike<TPayload>;
};

/** Main-realm coordinator. CPU work runs only in its bounded child Workers. */
export class BoundedCompilationMainBridge<TPayload, TResult> {
  private readonly pool: BoundedCompilationWorkerPool<TPayload, TResult>;
  private readonly serial: BoundedCompilationSerialWorker<TPayload, TResult>;
  private readonly maxSources: number;
  private readonly maxActiveJobs: number;
  private readonly sources = new Set<SourceState>();
  private nextSourceId = 0;
  private disposed = false;

  constructor(options: BoundedCompilationMainBridgeOptions<TPayload>) {
    this.pool = new BoundedCompilationWorkerPool(options);
    this.serial = new BoundedCompilationSerialWorker(options.createWorker);
    this.maxSources = positiveLimit(options.maxSources, 'bridge source limit');
    this.maxActiveJobs = positiveLimit(options.maxActiveJobs, 'bridge active-job limit');
  }

  attach(port: BoundedCompilationBridgePort): () => void {
    if (this.disposed) throw new Error('bounded compilation main bridge disposed');
    if (this.sources.size >= this.maxSources) {
      throw new Error('bounded compilation main bridge source capacity unavailable');
    }
    this.nextSourceId += 1;
    const source: SourceState = {
      sourceId: this.nextSourceId,
      port,
      active: new Map(),
      detached: false,
    };
    this.sources.add(source);
    port.onmessage = (event) => this.handleMessage(source, event.data);
    port.onmessageerror = () =>
      this.failSource(source, 'compilation bridge request was not cloneable');
    port.start?.();
    return () => this.detach(source);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of Array.from(this.sources)) this.detach(source);
    this.pool.dispose();
    this.serial.dispose();
  }

  private handleMessage(source: SourceState, value: unknown): void {
    if (source.detached) return;
    const request = parseBoundedCompilationBridgeRequest<TPayload>(value);
    if (request === null) {
      this.failSource(source, 'invalid bounded compilation bridge request');
      return;
    }
    if (request.kind === 'cancel') {
      const active = source.active.get(request.requestId);
      if (active === undefined) return;
      // Cancellation is bound to both correlation fields. A stale or corrupt
      // message that reuses only the request id must never cancel a different
      // public job now occupying that slot.
      if (active.externalJobId !== request.jobId) return;
      active.controller.abort();
      return;
    }
    if (source.active.has(request.requestId)) {
      this.sendJobError(
        source,
        request.requestId,
        request.jobId,
        new Error('duplicate bridge request'),
      );
      return;
    }
    if (this.activeJobCount() >= this.maxActiveJobs) {
      this.sendJobError(
        source,
        request.requestId,
        request.jobId,
        new Error('bounded compilation main bridge job capacity unavailable'),
      );
      return;
    }
    const controller = new AbortController();
    const active: ActiveRequest = {
      requestId: request.requestId,
      externalJobId: request.jobId,
      controller,
    };
    source.active.set(active.requestId, active);
    const internalJobId = `bridge:${source.sourceId}:${active.requestId}`;
    void this.pool
      .submit({
        jobId: internalJobId,
        tasks: request.tasks,
        signal: controller.signal,
        sequentialFallback: (tasks, context) => this.serial.run(tasks, context),
        onProgress: (progress) => {
          if (source.active.get(active.requestId) !== active) return;
          this.send(source, {
            channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
            kind: 'progress',
            requestId: active.requestId,
            jobId: active.externalJobId,
            progress: { ...progress, jobId: active.externalJobId },
          });
        },
      })
      .then(
        (results) => this.resolve(source, active, results),
        (error: unknown) => this.reject(source, active, asError(error)),
      );
  }

  private resolve(
    source: SourceState,
    active: ActiveRequest,
    results: ReadonlyArray<TResult>,
  ): void {
    if (!this.takeActive(source, active)) return;
    this.send(source, {
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'result',
      requestId: active.requestId,
      jobId: active.externalJobId,
      results,
    });
  }

  private reject(source: SourceState, active: ActiveRequest, error: Error): void {
    if (!this.takeActive(source, active)) return;
    this.sendJobError(source, active.requestId, active.externalJobId, error);
  }

  private takeActive(source: SourceState, active: ActiveRequest): boolean {
    if (source.detached || source.active.get(active.requestId) !== active) return false;
    source.active.delete(active.requestId);
    return true;
  }

  private sendJobError(
    source: SourceState,
    requestId: number,
    jobId: BoundedCompilationId,
    error: Error,
  ): void {
    this.send(source, {
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'error',
      requestId,
      jobId,
      errorName: error.name,
      message: error.message,
    });
  }

  private send(source: SourceState, response: BoundedCompilationBridgeResponse<TResult>): void {
    if (source.detached) return;
    try {
      source.port.postMessage(response);
    } catch (error) {
      this.failSource(source, `compilation bridge response failed: ${asError(error).message}`);
    }
  }

  private failSource(source: SourceState, message: string): void {
    if (source.detached) return;
    try {
      source.port.postMessage({
        channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
        kind: 'fatal',
        message,
      } satisfies BoundedCompilationBridgeResponse<TResult>);
    } catch {
      // The source is retired below even when its reply channel is dead.
    }
    this.detach(source);
  }

  private detach(source: SourceState): void {
    if (source.detached) return;
    source.detached = true;
    this.sources.delete(source);
    source.port.onmessage = null;
    source.port.onmessageerror = null;
    source.port.close?.();
    const active = Array.from(source.active.values());
    source.active.clear();
    for (const request of active) request.controller.abort();
  }

  private activeJobCount(): number {
    let count = 0;
    for (const source of this.sources) count += source.active.size;
    return count;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer`);
  return value;
}
