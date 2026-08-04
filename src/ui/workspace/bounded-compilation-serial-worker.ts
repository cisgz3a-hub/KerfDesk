import { parseCompilationResponse } from './bounded-compilation-worker-pool-helpers';
import type {
  BoundedCompilationSequentialContext,
  BoundedCompilationTask,
  BoundedCompilationWorkerLike,
} from './bounded-compilation-worker-pool-protocol';

type SerialEntry<TPayload, TResult> = {
  readonly runId: number;
  readonly tasks: ReadonlyArray<BoundedCompilationTask<TPayload>>;
  readonly context: BoundedCompilationSequentialContext;
  readonly resolve: (results: ReadonlyArray<TResult>) => void;
  readonly reject: (error: Error) => void;
  readonly abort: () => void;
  worker: BoundedCompilationWorkerLike<TPayload> | null;
  index: number;
  results: TResult[];
};

/** One global serial worker lane used only for whole-generation fallback. */
export class BoundedCompilationSerialWorker<TPayload, TResult> {
  private readonly createWorker: () => BoundedCompilationWorkerLike<TPayload>;
  private queue: Array<SerialEntry<TPayload, TResult>> = [];
  private active: SerialEntry<TPayload, TResult> | null = null;
  private nextRunId = 0;
  private disposed = false;

  constructor(createWorker: () => BoundedCompilationWorkerLike<TPayload>) {
    this.createWorker = createWorker;
  }

  run(
    tasks: ReadonlyArray<BoundedCompilationTask<TPayload>>,
    context: BoundedCompilationSequentialContext,
  ): Promise<ReadonlyArray<TResult>> {
    if (this.disposed) return Promise.reject(new Error('serial compilation worker disposed'));
    if (context.signal.aborted) return Promise.reject(abortError());
    if (tasks.length === 0) return Promise.resolve([]);
    return new Promise<ReadonlyArray<TResult>>((resolve, reject) => {
      this.nextRunId += 1;
      const entry: SerialEntry<TPayload, TResult> = {
        runId: this.nextRunId,
        tasks,
        context,
        resolve,
        reject,
        abort: () => this.cancel(entry),
        worker: null,
        index: 0,
        results: [],
      };
      context.signal.addEventListener('abort', entry.abort, { once: true });
      this.queue.push(entry);
      this.pump();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const active = this.active;
    if (active !== null) this.finish(active, new Error('serial compilation worker disposed'));
    const queued = this.queue;
    this.queue = [];
    for (const entry of queued) {
      this.detachAbort(entry);
      entry.reject(new Error('serial compilation worker disposed'));
    }
  }

  private pump(): void {
    if (this.disposed || this.active !== null) return;
    const entry = this.queue.shift();
    if (entry === undefined) return;
    this.active = entry;
    try {
      const worker = this.createWorker();
      entry.worker = worker;
      worker.onmessage = (event) => this.handleMessage(entry, worker, event.data);
      worker.onerror = () => this.finish(entry, new Error('serial compilation worker errored'));
      worker.onmessageerror = () =>
        this.finish(entry, new Error('serial compilation worker response was not cloneable'));
      this.postCurrent(entry, worker);
    } catch (error) {
      this.finish(entry, asError(error));
    }
  }

  private postCurrent(
    entry: SerialEntry<TPayload, TResult>,
    worker: BoundedCompilationWorkerLike<TPayload>,
  ): void {
    const task = entry.tasks[entry.index];
    if (task === undefined) {
      this.finish(entry, null);
      return;
    }
    try {
      worker.postMessage({
        kind: 'run',
        submissionId: entry.runId,
        jobId: entry.context.jobId,
        taskId: task.taskId,
        payload: task.payload,
      });
    } catch (error) {
      this.finish(entry, asError(error));
    }
  }

  private handleMessage(
    entry: SerialEntry<TPayload, TResult>,
    worker: BoundedCompilationWorkerLike<TPayload>,
    value: unknown,
  ): void {
    if (this.active !== entry || entry.worker !== worker) return;
    const task = entry.tasks[entry.index];
    const response = parseCompilationResponse<TResult>(value);
    if (
      task === undefined ||
      response === null ||
      response.submissionId !== entry.runId ||
      response.jobId !== entry.context.jobId ||
      response.taskId !== task.taskId
    ) {
      this.finish(entry, new Error('serial compilation worker returned mismatched identity'));
      return;
    }
    if (response.kind === 'error') {
      this.finish(entry, new Error(response.message));
      return;
    }
    entry.results.push(response.result);
    entry.index += 1;
    entry.context.reportCompleted(entry.index);
    this.postCurrent(entry, worker);
  }

  private cancel(entry: SerialEntry<TPayload, TResult>): void {
    if (this.active === entry) {
      this.finish(entry, abortError());
      return;
    }
    const index = this.queue.indexOf(entry);
    if (index < 0) return;
    this.queue.splice(index, 1);
    this.detachAbort(entry);
    entry.reject(abortError());
  }

  private finish(entry: SerialEntry<TPayload, TResult>, error: Error | null): void {
    if (this.active !== entry) return;
    this.active = null;
    this.detachAbort(entry);
    retire(entry.worker);
    entry.worker = null;
    if (error === null) entry.resolve(entry.results);
    else entry.reject(error);
    this.pump();
  }

  private detachAbort(entry: SerialEntry<TPayload, TResult>): void {
    entry.context.signal.removeEventListener('abort', entry.abort);
  }
}

function retire<TPayload>(worker: BoundedCompilationWorkerLike<TPayload> | null): void {
  if (worker === null) return;
  worker.onmessage = null;
  worker.onerror = null;
  worker.onmessageerror = null;
  try {
    worker.terminate();
  } catch {
    // The worker is already detached from the serial lane.
  }
}

function abortError(): Error {
  const error = new Error('compilation job aborted');
  error.name = 'AbortError';
  return error;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
