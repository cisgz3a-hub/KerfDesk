import type {
  BoundedCompilationId,
  BoundedCompilationJob,
  BoundedCompilationJobState,
  BoundedCompilationProgress,
  BoundedCompilationResultCell,
  BoundedCompilationWorkerResponse,
  BoundedCompilationWorkerSlot,
} from './bounded-compilation-worker-pool-protocol';

export function clampCompilationConcurrency(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(4, Math.max(2, Math.trunc(value)));
}

export function validateCompilationJob<TPayload, TResult>(
  job: BoundedCompilationJob<TPayload, TResult>,
  duplicateJobId: boolean,
): Error | null {
  if (duplicateJobId) return new Error(`compilation job ${String(job.jobId)} is already active`);
  const taskIds = new Set<BoundedCompilationId>();
  for (const task of job.tasks) {
    if (taskIds.has(task.taskId)) {
      return new Error(`compilation task ${String(task.taskId)} is duplicated`);
    }
    taskIds.add(task.taskId);
  }
  return null;
}

export function createCompilationJobState<TPayload, TResult>(
  job: BoundedCompilationJob<TPayload, TResult>,
  submissionId: number,
  resolve: (results: ReadonlyArray<TResult>) => void,
  reject: (error: Error) => void,
): BoundedCompilationJobState<TPayload, TResult> {
  const tasks = Object.freeze(job.tasks.map((task) => Object.freeze({ ...task })));
  return {
    submissionId,
    jobId: job.jobId,
    tasks,
    sequentialFallback: job.sequentialFallback,
    onProgress: job.onProgress,
    controller: new AbortController(),
    resolve,
    reject,
    detachExternalAbort: null,
    mode: 'parallel',
    nextTaskIndex: 0,
    completed: 0,
    fallbackRun: 0,
    readyEnqueued: false,
    cells: emptyCompilationResultCells(tasks.length),
    activeTaskIndexes: new Set<number>(),
  };
}

export function attachCompilationAbort<TPayload, TResult>(
  job: BoundedCompilationJobState<TPayload, TResult>,
  signal: AbortSignal,
  cancel: () => void,
): void {
  signal.addEventListener('abort', cancel, { once: true });
  job.detachExternalAbort = () => signal.removeEventListener('abort', cancel);
}

export function enqueueReadyJob<TPayload, TResult>(
  readyJobs: Array<BoundedCompilationJobState<TPayload, TResult>>,
  job: BoundedCompilationJobState<TPayload, TResult>,
): void {
  if (job.mode !== 'parallel' || job.readyEnqueued || job.nextTaskIndex >= job.tasks.length) return;
  job.readyEnqueued = true;
  readyJobs.push(job);
}

export function takeReadyJob<TPayload, TResult>(
  readyJobs: Array<BoundedCompilationJobState<TPayload, TResult>>,
): BoundedCompilationJobState<TPayload, TResult> | null {
  while (readyJobs.length > 0) {
    const job = readyJobs.shift();
    if (job === undefined) return null;
    job.readyEnqueued = false;
    if (job.mode === 'parallel' && job.nextTaskIndex < job.tasks.length) return job;
  }
  return null;
}

export function removeReadyJob<TPayload, TResult>(
  readyJobs: Array<BoundedCompilationJobState<TPayload, TResult>>,
  job: BoundedCompilationJobState<TPayload, TResult>,
): void {
  if (!job.readyEnqueued) return;
  job.readyEnqueued = false;
  const index = readyJobs.indexOf(job);
  if (index >= 0) readyJobs.splice(index, 1);
}

export function settleCompilationJob<TPayload, TResult>(
  job: BoundedCompilationJobState<TPayload, TResult>,
  readyJobs: Array<BoundedCompilationJobState<TPayload, TResult>>,
  jobs: Map<BoundedCompilationId, BoundedCompilationJobState<TPayload, TResult>>,
): boolean {
  if (job.mode === 'settled') return false;
  removeReadyJob(readyJobs, job);
  job.mode = 'settled';
  job.detachExternalAbort?.();
  job.detachExternalAbort = null;
  jobs.delete(job.jobId);
  return true;
}

export function retireWorkerSlotsForJob<TPayload, TResult>(
  slots: ReadonlyArray<BoundedCompilationWorkerSlot<TPayload, TResult>>,
  job: BoundedCompilationJobState<TPayload, TResult>,
): void {
  for (const slot of slots) {
    if (slot.assignment?.job === job) retireWorkerSlot(slot);
  }
}

export function retireWorkerSlot<TPayload, TResult>(
  slot: BoundedCompilationWorkerSlot<TPayload, TResult>,
): void {
  const worker = slot.worker;
  slot.worker = null;
  slot.assignment = null;
  if (worker === null) return;
  worker.onmessage = null;
  worker.onerror = null;
  worker.onmessageerror = null;
  try {
    worker.terminate();
  } catch {
    // Retirement is already complete from the coordinator's perspective.
  }
}

export function emitParallelProgress<TPayload, TResult>(
  job: BoundedCompilationJobState<TPayload, TResult>,
): void {
  emitProgress(job, {
    jobId: job.jobId,
    phase: 'parallel',
    completed: job.completed,
    active: job.activeTaskIndexes.size,
    queued: job.tasks.length - job.completed - job.activeTaskIndexes.size,
    total: job.tasks.length,
  });
}

export function emitFallbackProgress<TPayload, TResult>(
  job: BoundedCompilationJobState<TPayload, TResult>,
  completed: number,
): void {
  const remaining = job.tasks.length - completed;
  const active = remaining > 0 ? 1 : 0;
  emitProgress(job, {
    jobId: job.jobId,
    phase: 'sequential-fallback',
    completed,
    active,
    queued: Math.max(0, remaining - active),
    total: job.tasks.length,
  });
}

function emitProgress<TPayload, TResult>(
  job: BoundedCompilationJobState<TPayload, TResult>,
  progress: BoundedCompilationProgress,
): void {
  try {
    job.onProgress?.(progress);
  } catch {
    // Progress is observational and never owns compilation lifecycle.
  }
}

export function parseCompilationResponse<TResult>(
  value: unknown,
): BoundedCompilationWorkerResponse<TResult> | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(candidate.submissionId) ||
    !isCompilationId(candidate.jobId) ||
    !isCompilationId(candidate.taskId)
  ) {
    return null;
  }
  if (candidate.kind === 'ok') {
    return {
      kind: 'ok',
      submissionId: candidate.submissionId as number,
      jobId: candidate.jobId,
      taskId: candidate.taskId,
      result: candidate.result as TResult,
    };
  }
  if (candidate.kind === 'error' && typeof candidate.message === 'string') {
    return {
      kind: 'error',
      submissionId: candidate.submissionId as number,
      jobId: candidate.jobId,
      taskId: candidate.taskId,
      message: candidate.message,
    };
  }
  return null;
}

function isCompilationId(value: unknown): value is BoundedCompilationId {
  return typeof value === 'string' || typeof value === 'number';
}

export function emptyCompilationResultCells<TResult>(
  length: number,
): Array<BoundedCompilationResultCell<TResult>> {
  return Array.from({ length }, () => ({ done: false }) as const);
}

export function completedCompilationResults<TResult>(
  cells: ReadonlyArray<BoundedCompilationResultCell<TResult>>,
): ReadonlyArray<TResult> {
  return cells.map((cell) => {
    if (!cell.done) throw new Error('compilation result generation is incomplete');
    return cell.value;
  });
}

export function compilationAbortError(): Error {
  const error = new Error('compilation job aborted');
  error.name = 'AbortError';
  return error;
}
