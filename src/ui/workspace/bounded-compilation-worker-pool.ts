import type {
  BoundedCompilationId,
  BoundedCompilationJob,
  BoundedCompilationJobState,
  BoundedCompilationSequentialContext,
  BoundedCompilationWorkerLike,
  BoundedCompilationWorkerPoolOptions,
  BoundedCompilationWorkerSlot,
} from './bounded-compilation-worker-pool-protocol';
import {
  attachCompilationAbort,
  clampCompilationConcurrency,
  compilationAbortError,
  completedCompilationResults,
  createCompilationJobState,
  emitFallbackProgress,
  emitParallelProgress,
  emptyCompilationResultCells,
  enqueueReadyJob,
  parseCompilationResponse,
  removeReadyJob,
  retireWorkerSlot,
  retireWorkerSlotsForJob,
  settleCompilationJob,
  takeReadyJob,
  validateCompilationJob,
} from './bounded-compilation-worker-pool-helpers';

export type * from './bounded-compilation-worker-pool-protocol';

type JobState<TPayload, TResult> = BoundedCompilationJobState<TPayload, TResult>;
type WorkerSlot<TPayload, TResult> = BoundedCompilationWorkerSlot<TPayload, TResult>;

/**
 * Bounded child-worker scheduling for an outer preparation Worker. This class
 * does not make its whole-job fallback suitable for browser-main-thread use.
 */
export class BoundedCompilationWorkerPool<TPayload, TResult> {
  public readonly concurrency: number;

  private readonly createWorker: () => BoundedCompilationWorkerLike<TPayload>;
  private readonly slots: Array<WorkerSlot<TPayload, TResult>>;
  private readonly jobs = new Map<BoundedCompilationId, JobState<TPayload, TResult>>();
  private readyJobs: Array<JobState<TPayload, TResult>> = [];
  private nextSubmissionId = 0;
  private disposed = false;
  private pumping = false;

  constructor(options: BoundedCompilationWorkerPoolOptions<TPayload>) {
    this.concurrency = clampCompilationConcurrency(options.concurrency);
    this.createWorker = options.createWorker;
    this.slots = Array.from({ length: this.concurrency }, () => ({
      worker: null,
      assignment: null,
    }));
  }

  submit(job: BoundedCompilationJob<TPayload, TResult>): Promise<ReadonlyArray<TResult>> {
    if (this.disposed) return Promise.reject(new Error('bounded compilation worker pool disposed'));
    const validationError = validateCompilationJob(job, this.jobs.has(job.jobId));
    if (validationError !== null) return Promise.reject(validationError);
    if (job.signal?.aborted === true) return Promise.reject(compilationAbortError());

    return new Promise<ReadonlyArray<TResult>>((resolve, reject) => {
      this.nextSubmissionId += 1;
      const state = createCompilationJobState(job, this.nextSubmissionId, resolve, reject);
      this.jobs.set(state.jobId, state);
      if (job.signal !== undefined) {
        attachCompilationAbort(state, job.signal, () => this.cancelJob(state));
      }
      emitParallelProgress(state);
      if (state.tasks.length === 0) this.startSequentialFallback(state);
      else {
        enqueueReadyJob(this.readyJobs, state);
        this.pump();
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) retireWorkerSlot(slot);
    this.readyJobs = [];
    for (const job of Array.from(this.jobs.values())) {
      job.controller.abort();
      this.settleRejected(job, new Error('bounded compilation worker pool disposed'));
    }
  }

  private cancelJob(job: JobState<TPayload, TResult>): void {
    if (job.mode === 'settled') return;
    job.controller.abort();
    removeReadyJob(this.readyJobs, job);
    retireWorkerSlotsForJob(this.slots, job);
    this.settleRejected(job, compilationAbortError());
    this.pump();
  }

  private pump(): void {
    if (this.disposed || this.pumping) return;
    this.pumping = true;
    try {
      while (true) {
        const slot = this.slots.find((candidate) => candidate.assignment === null);
        if (slot === undefined) break;
        const job = takeReadyJob(this.readyJobs);
        if (job === null) break;
        this.dispatch(slot, job);
      }
    } finally {
      this.pumping = false;
    }
  }

  private dispatch(slot: WorkerSlot<TPayload, TResult>, job: JobState<TPayload, TResult>): void {
    const worker = this.workerForSlot(slot, job);
    if (worker === null || job.mode !== 'parallel') return;
    const taskIndex = job.nextTaskIndex;
    const task = job.tasks[taskIndex];
    if (task === undefined) return;
    job.nextTaskIndex += 1;
    job.activeTaskIndexes.add(taskIndex);
    slot.assignment = { job, taskIndex, taskId: task.taskId };
    if (job.nextTaskIndex < job.tasks.length) enqueueReadyJob(this.readyJobs, job);
    emitParallelProgress(job);
    try {
      worker.postMessage({
        kind: 'run',
        submissionId: job.submissionId,
        jobId: job.jobId,
        taskId: task.taskId,
        payload: task.payload,
      });
    } catch {
      this.startSequentialFallback(job);
    }
  }

  private workerForSlot(
    slot: WorkerSlot<TPayload, TResult>,
    job: JobState<TPayload, TResult>,
  ): BoundedCompilationWorkerLike<TPayload> | null {
    if (slot.worker !== null) return slot.worker;
    try {
      const worker = this.createWorker();
      slot.worker = worker;
      worker.onmessage = (event) => this.handleMessage(slot, worker, event.data);
      worker.onerror = () => this.handleWorkerFailure(slot, worker);
      worker.onmessageerror = () => this.handleWorkerFailure(slot, worker);
      return worker;
    } catch {
      this.startSequentialFallback(job);
      return null;
    }
  }

  private handleMessage(
    slot: WorkerSlot<TPayload, TResult>,
    worker: BoundedCompilationWorkerLike<TPayload>,
    value: unknown,
  ): void {
    if (this.disposed || slot.worker !== worker) return;
    const assignment = slot.assignment;
    if (assignment === null) {
      retireWorkerSlot(slot);
      this.pump();
      return;
    }
    const response = parseCompilationResponse<TResult>(value);
    if (response === null) {
      this.startSequentialFallback(assignment.job);
      return;
    }
    if (response.submissionId !== assignment.job.submissionId) return;
    if (
      response.jobId !== assignment.job.jobId ||
      response.taskId !== assignment.taskId ||
      response.kind === 'error'
    ) {
      this.startSequentialFallback(assignment.job);
      return;
    }
    const job = assignment.job;
    if (job.mode !== 'parallel') return;
    slot.assignment = null;
    job.activeTaskIndexes.delete(assignment.taskIndex);
    job.cells[assignment.taskIndex] = { done: true, value: response.result };
    job.completed += 1;
    emitParallelProgress(job);
    if (job.completed === job.tasks.length) {
      this.settleResolved(job, completedCompilationResults(job.cells));
    }
    this.pump();
  }

  private handleWorkerFailure(
    slot: WorkerSlot<TPayload, TResult>,
    worker: BoundedCompilationWorkerLike<TPayload>,
  ): void {
    if (this.disposed || slot.worker !== worker) return;
    const job = slot.assignment?.job;
    if (job === undefined) {
      retireWorkerSlot(slot);
      this.pump();
    } else {
      this.startSequentialFallback(job);
    }
  }

  private startSequentialFallback(job: JobState<TPayload, TResult>): void {
    if (job.mode === 'fallback' || job.mode === 'settled') return;
    job.mode = 'fallback';
    job.fallbackRun += 1;
    const run = job.fallbackRun;
    removeReadyJob(this.readyJobs, job);
    retireWorkerSlotsForJob(this.slots, job);
    job.nextTaskIndex = job.tasks.length;
    job.completed = 0;
    job.cells = emptyCompilationResultCells(job.tasks.length);
    job.activeTaskIndexes.clear();
    emitFallbackProgress(job, 0);
    this.pump();

    const context: BoundedCompilationSequentialContext = {
      jobId: job.jobId,
      signal: job.controller.signal,
      reportCompleted: (completed) => {
        if (job.mode !== 'fallback' || job.fallbackRun !== run) return;
        const bounded = Math.max(job.completed, Math.min(job.tasks.length, Math.trunc(completed)));
        job.completed = Number.isFinite(bounded) ? bounded : job.completed;
        emitFallbackProgress(job, job.completed);
      },
    };
    void Promise.resolve()
      .then(() =>
        job.mode === 'fallback' && job.fallbackRun === run
          ? job.sequentialFallback(job.tasks, context)
          : [],
      )
      .then(
        (results) => {
          if (job.mode !== 'fallback' || job.fallbackRun !== run) return;
          if (results.length !== job.tasks.length) {
            this.settleRejected(
              job,
              new Error('sequential compilation fallback returned the wrong result count'),
            );
            return;
          }
          job.completed = job.tasks.length;
          emitFallbackProgress(job, job.completed);
          this.settleResolved(job, Array.from(results));
        },
        (error: unknown) => {
          if (job.mode !== 'fallback' || job.fallbackRun !== run) return;
          this.settleRejected(job, error instanceof Error ? error : new Error(String(error)));
        },
      );
  }

  private settleResolved(job: JobState<TPayload, TResult>, results: ReadonlyArray<TResult>): void {
    if (!settleCompilationJob(job, this.readyJobs, this.jobs)) return;
    job.resolve(results);
  }

  private settleRejected(job: JobState<TPayload, TResult>, error: Error): void {
    if (!settleCompilationJob(job, this.readyJobs, this.jobs)) return;
    job.reject(error);
  }
}
