import {
  BOUNDED_COMPILATION_BRIDGE_CHANNEL,
  parseBoundedCompilationBridgeResponse,
  type BoundedCompilationBridgeJob,
  type BoundedCompilationBridgePort,
  type BoundedCompilationBridgeRequest,
} from './bounded-compilation-bridge-protocol';
import type { BoundedCompilationId } from './bounded-compilation-worker-pool-protocol';

type Pending<TResult> = {
  readonly requestId: number;
  readonly jobId: BoundedCompilationId;
  readonly expectedResults: number;
  readonly resolve: (results: ReadonlyArray<TResult>) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress: BoundedCompilationBridgeJob<unknown>['onProgress'];
  readonly detachAbort: (() => void) | null;
};

/** RPC client hosted inside an outer preparation Worker; it never evaluates tasks. */
export class BoundedCompilationBridgeClient<TPayload, TResult> {
  private readonly port: BoundedCompilationBridgePort;
  private readonly maxPendingJobs: number;
  private readonly pending = new Map<number, Pending<TResult>>();
  private readonly activeJobIds = new Set<BoundedCompilationId>();
  private nextRequestId = 0;
  private disposed = false;

  constructor(port: BoundedCompilationBridgePort, maxPendingJobs = 1) {
    this.port = port;
    this.maxPendingJobs = positiveLimit(maxPendingJobs, 'bridge client pending-job limit');
    port.onmessage = (event) => this.handleMessage(event.data);
    port.onmessageerror = () =>
      this.failTerminal(new Error('compilation bridge response was not cloneable'));
    port.start?.();
  }

  submit(job: BoundedCompilationBridgeJob<TPayload>): Promise<ReadonlyArray<TResult>> {
    if (this.disposed)
      return Promise.reject(new Error('bounded compilation bridge client disposed'));
    if (this.pending.size >= this.maxPendingJobs) {
      return Promise.reject(new Error('bounded compilation bridge client is at capacity'));
    }
    const invalid = validateJob(job, this.activeJobIds.has(job.jobId));
    if (invalid !== null) return Promise.reject(invalid);
    if (job.signal?.aborted === true) return Promise.reject(abortError());
    this.nextRequestId += 1;
    const requestId = this.nextRequestId;
    return new Promise<ReadonlyArray<TResult>>((resolve, reject) => {
      const abort = (): void => this.abort(requestId);
      const pending: Pending<TResult> = {
        requestId,
        jobId: job.jobId,
        expectedResults: job.tasks.length,
        resolve,
        reject,
        onProgress: job.onProgress,
        detachAbort:
          job.signal === undefined ? null : () => job.signal?.removeEventListener('abort', abort),
      };
      this.pending.set(requestId, pending);
      this.activeJobIds.add(job.jobId);
      job.signal?.addEventListener('abort', abort, { once: true });
      const request: BoundedCompilationBridgeRequest<TPayload> = {
        channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
        kind: 'submit',
        requestId,
        jobId: job.jobId,
        tasks: job.tasks,
      };
      try {
        this.port.postMessage(request);
      } catch (error) {
        this.rejectPending(pending, asError(error));
      }
    });
  }

  dispose(error = new Error('bounded compilation bridge client disposed')): void {
    if (this.disposed) return;
    this.failTerminal(error);
  }

  private handleMessage(value: unknown): void {
    if (this.disposed) return;
    const response = parseBoundedCompilationBridgeResponse<TResult>(value);
    if (response === null) {
      this.failTerminal(new Error('invalid bounded compilation bridge response'));
      return;
    }
    if (response.kind === 'fatal') {
      this.failTerminal(new Error(response.message));
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (pending === undefined) return;
    if (pending.jobId !== response.jobId) {
      this.rejectPending(pending, new Error('compilation bridge response identity mismatch'));
      this.sendCancel(pending);
      return;
    }
    if (response.kind === 'progress') {
      try {
        pending.onProgress?.(response.progress);
      } catch {
        // Progress is observational and cannot own compilation lifecycle.
      }
      return;
    }
    if (response.kind === 'error') {
      const error = new Error(response.message);
      error.name = response.errorName;
      this.rejectPending(pending, error);
      return;
    }
    if (response.results.length !== pending.expectedResults) {
      this.rejectPending(pending, new Error('compilation bridge returned the wrong result count'));
      return;
    }
    this.resolvePending(pending, response.results);
  }

  private abort(requestId: number): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.rejectPending(pending, abortError());
    this.sendCancel(pending);
  }

  private sendCancel(pending: Pending<TResult>): void {
    try {
      this.port.postMessage({
        channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
        kind: 'cancel',
        requestId: pending.requestId,
        jobId: pending.jobId,
      } satisfies BoundedCompilationBridgeRequest<TPayload>);
    } catch {
      // The local promise is already rejected; main-realm retirement is the final backstop.
    }
  }

  private resolvePending(pending: Pending<TResult>, results: ReadonlyArray<TResult>): void {
    if (!this.takePending(pending)) return;
    pending.resolve(results);
  }

  private rejectPending(pending: Pending<TResult>, error: Error): void {
    if (!this.takePending(pending)) return;
    pending.reject(error);
  }

  private takePending(pending: Pending<TResult>): boolean {
    if (this.pending.get(pending.requestId) !== pending) return false;
    this.pending.delete(pending.requestId);
    this.activeJobIds.delete(pending.jobId);
    pending.detachAbort?.();
    return true;
  }

  private failTerminal(error: Error): void {
    if (this.disposed) return;
    this.disposed = true;
    const pending = Array.from(this.pending.values());
    for (const request of pending) this.sendCancel(request);
    this.port.onmessage = null;
    this.port.onmessageerror = null;
    for (const request of pending) this.rejectPending(request, error);
    this.port.close?.();
  }
}

function validateJob<TPayload>(
  job: BoundedCompilationBridgeJob<TPayload>,
  duplicateJobId: boolean,
): Error | null {
  if (duplicateJobId) return new Error(`compilation job ${String(job.jobId)} is already active`);
  const taskIds = new Set<BoundedCompilationId>();
  for (const task of job.tasks) {
    if (taskIds.has(task.taskId))
      return new Error(`compilation task ${String(task.taskId)} is duplicated`);
    taskIds.add(task.taskId);
  }
  return null;
}

function abortError(): Error {
  const error = new Error('compilation job aborted');
  error.name = 'AbortError';
  return error;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${label} must be a positive integer`);
  return value;
}
