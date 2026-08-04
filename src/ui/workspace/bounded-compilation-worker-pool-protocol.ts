export type BoundedCompilationId = string | number;

export type BoundedCompilationTask<TPayload> = {
  readonly taskId: BoundedCompilationId;
  readonly payload: TPayload;
};

export type BoundedCompilationWorkerRequest<TPayload> = {
  readonly kind: 'run';
  readonly submissionId: number;
  readonly jobId: BoundedCompilationId;
  readonly taskId: BoundedCompilationId;
  readonly payload: TPayload;
};

export type BoundedCompilationWorkerResponse<TResult> =
  | {
      readonly kind: 'ok';
      readonly submissionId: number;
      readonly jobId: BoundedCompilationId;
      readonly taskId: BoundedCompilationId;
      readonly result: TResult;
    }
  | {
      readonly kind: 'error';
      readonly submissionId: number;
      readonly jobId: BoundedCompilationId;
      readonly taskId: BoundedCompilationId;
      readonly message: string;
    };

export type BoundedCompilationProgress = {
  readonly jobId: BoundedCompilationId;
  readonly phase: 'parallel' | 'sequential-fallback';
  readonly completed: number;
  readonly active: number;
  readonly queued: number;
  readonly total: number;
};

export type BoundedCompilationSequentialContext = {
  readonly jobId: BoundedCompilationId;
  readonly signal: AbortSignal;
  readonly reportCompleted: (completed: number) => void;
};

export interface BoundedCompilationWorkerLike<TPayload> {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: BoundedCompilationWorkerRequest<TPayload>): void;
  terminate(): void;
}

export type BoundedCompilationJob<TPayload, TResult> = {
  readonly jobId: BoundedCompilationId;
  readonly tasks: ReadonlyArray<BoundedCompilationTask<TPayload>>;
  /**
   * Whole-job fallback for an outer preparation Worker. It is deliberately
   * async so pool failure never invokes a synchronous task evaluator inline.
   */
  readonly sequentialFallback: (
    tasks: ReadonlyArray<BoundedCompilationTask<TPayload>>,
    context: BoundedCompilationSequentialContext,
  ) => Promise<ReadonlyArray<TResult>>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: BoundedCompilationProgress) => void;
};

export type BoundedCompilationWorkerPoolOptions<TPayload> = {
  readonly concurrency: number;
  readonly createWorker: () => BoundedCompilationWorkerLike<TPayload>;
};

export type BoundedCompilationResultCell<TResult> =
  | { readonly done: false }
  | { readonly done: true; readonly value: TResult };

export type BoundedCompilationJobState<TPayload, TResult> = {
  readonly submissionId: number;
  readonly jobId: BoundedCompilationId;
  readonly tasks: ReadonlyArray<BoundedCompilationTask<TPayload>>;
  readonly sequentialFallback: BoundedCompilationJob<TPayload, TResult>['sequentialFallback'];
  readonly onProgress: BoundedCompilationJob<TPayload, TResult>['onProgress'];
  readonly controller: AbortController;
  readonly resolve: (results: ReadonlyArray<TResult>) => void;
  readonly reject: (error: Error) => void;
  detachExternalAbort: (() => void) | null;
  mode: 'parallel' | 'fallback' | 'settled';
  nextTaskIndex: number;
  completed: number;
  fallbackRun: number;
  readyEnqueued: boolean;
  cells: Array<BoundedCompilationResultCell<TResult>>;
  readonly activeTaskIndexes: Set<number>;
};

export type BoundedCompilationAssignment<TPayload, TResult> = {
  readonly job: BoundedCompilationJobState<TPayload, TResult>;
  readonly taskIndex: number;
  readonly taskId: BoundedCompilationId;
};

export type BoundedCompilationWorkerSlot<TPayload, TResult> = {
  worker: BoundedCompilationWorkerLike<TPayload> | null;
  assignment: BoundedCompilationAssignment<TPayload, TResult> | null;
};
