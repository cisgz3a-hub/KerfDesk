import type {
  BoundedCompilationId,
  BoundedCompilationProgress,
  BoundedCompilationTask,
} from './bounded-compilation-worker-pool-protocol';

export const BOUNDED_COMPILATION_BRIDGE_CHANNEL = 'bounded-compilation-bridge-v1';

export interface BoundedCompilationBridgePort {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
}

export type BoundedCompilationBridgeJob<TPayload> = {
  readonly jobId: BoundedCompilationId;
  readonly tasks: ReadonlyArray<BoundedCompilationTask<TPayload>>;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: BoundedCompilationProgress) => void;
};

export type BoundedCompilationBridgeRequest<TPayload> =
  | {
      readonly channel: typeof BOUNDED_COMPILATION_BRIDGE_CHANNEL;
      readonly kind: 'submit';
      readonly requestId: number;
      readonly jobId: BoundedCompilationId;
      readonly tasks: ReadonlyArray<BoundedCompilationTask<TPayload>>;
    }
  | {
      readonly channel: typeof BOUNDED_COMPILATION_BRIDGE_CHANNEL;
      readonly kind: 'cancel';
      readonly requestId: number;
      readonly jobId: BoundedCompilationId;
    };

export type BoundedCompilationBridgeResponse<TResult> =
  | {
      readonly channel: typeof BOUNDED_COMPILATION_BRIDGE_CHANNEL;
      readonly kind: 'progress';
      readonly requestId: number;
      readonly jobId: BoundedCompilationId;
      readonly progress: BoundedCompilationProgress;
    }
  | {
      readonly channel: typeof BOUNDED_COMPILATION_BRIDGE_CHANNEL;
      readonly kind: 'result';
      readonly requestId: number;
      readonly jobId: BoundedCompilationId;
      readonly results: ReadonlyArray<TResult>;
    }
  | {
      readonly channel: typeof BOUNDED_COMPILATION_BRIDGE_CHANNEL;
      readonly kind: 'error';
      readonly requestId: number;
      readonly jobId: BoundedCompilationId;
      readonly errorName: string;
      readonly message: string;
    }
  | {
      readonly channel: typeof BOUNDED_COMPILATION_BRIDGE_CHANNEL;
      readonly kind: 'fatal';
      readonly message: string;
    };

export function parseBoundedCompilationBridgeRequest<TPayload>(
  value: unknown,
): BoundedCompilationBridgeRequest<TPayload> | null {
  const candidate = bridgeRecord(value);
  if (candidate === null || !validRequestIdentity(candidate)) return null;
  if (candidate.kind === 'cancel') {
    return {
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'cancel',
      requestId: candidate.requestId as number,
      jobId: candidate.jobId,
    };
  }
  if (candidate.kind !== 'submit' || !Array.isArray(candidate.tasks)) return null;
  const tasks: Array<BoundedCompilationTask<TPayload>> = [];
  for (const valueTask of candidate.tasks) {
    if (typeof valueTask !== 'object' || valueTask === null) return null;
    const task = valueTask as Record<string, unknown>;
    if (!validCompilationId(task.taskId) || !('payload' in task)) return null;
    tasks.push({ taskId: task.taskId, payload: task.payload as TPayload });
  }
  return {
    channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
    kind: 'submit',
    requestId: candidate.requestId as number,
    jobId: candidate.jobId,
    tasks,
  };
}

export function parseBoundedCompilationBridgeResponse<TResult>(
  value: unknown,
): BoundedCompilationBridgeResponse<TResult> | null {
  const candidate = bridgeRecord(value);
  if (candidate === null) return null;
  if (candidate.kind === 'fatal' && typeof candidate.message === 'string') {
    return {
      channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
      kind: 'fatal',
      message: candidate.message,
    };
  }
  if (!validRequestIdentity(candidate)) return null;
  const identity = {
    channel: BOUNDED_COMPILATION_BRIDGE_CHANNEL,
    requestId: candidate.requestId as number,
    jobId: candidate.jobId,
  } as const;
  if (candidate.kind === 'result' && Array.isArray(candidate.results)) {
    return { ...identity, kind: 'result', results: candidate.results as ReadonlyArray<TResult> };
  }
  if (
    candidate.kind === 'error' &&
    typeof candidate.errorName === 'string' &&
    typeof candidate.message === 'string'
  ) {
    return {
      ...identity,
      kind: 'error',
      errorName: candidate.errorName,
      message: candidate.message,
    };
  }
  if (candidate.kind !== 'progress' || !validProgress(candidate.progress)) return null;
  return { ...identity, kind: 'progress', progress: candidate.progress };
}

function bridgeRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  return candidate.channel === BOUNDED_COMPILATION_BRIDGE_CHANNEL ? candidate : null;
}

function validRequestIdentity(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { requestId: number; jobId: BoundedCompilationId } {
  return (
    Number.isSafeInteger(value.requestId) &&
    (value.requestId as number) > 0 &&
    validCompilationId(value.jobId)
  );
}

function validCompilationId(value: unknown): value is BoundedCompilationId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value));
}

function validProgress(value: unknown): value is BoundedCompilationProgress {
  if (typeof value !== 'object' || value === null) return false;
  const progress = value as Record<string, unknown>;
  if (!validCompilationId(progress.jobId)) return false;
  if (progress.phase !== 'parallel' && progress.phase !== 'sequential-fallback') return false;
  return ['completed', 'active', 'queued', 'total'].every(
    (key) => Number.isSafeInteger(progress[key]) && (progress[key] as number) >= 0,
  );
}
