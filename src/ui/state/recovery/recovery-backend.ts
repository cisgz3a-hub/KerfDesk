import {
  emptyRecoverySlots,
  type PersistedRecoverySlots,
  type StoredRecoveryArtifact,
  validStoredArtifact,
} from './recovery-model';
import { activeStoredArtifactStagingLeaseExpiry } from './recovery-artifact-staging';
import { persistedRecoveryArtifactRunIds } from './recovery-artifact-retention';

export type RecoverySlotMutation<T> = {
  readonly slots: PersistedRecoverySlots;
  readonly value: T;
};

export type RecoveryStorageBackend = {
  readonly readSlots: () => Promise<unknown>;
  readonly mutateSlots: <T>(mutate: (current: unknown) => RecoverySlotMutation<T>) => Promise<T>;
  readonly mutateSlotsWithArtifact: <T>(
    runId: string,
    mutate: (current: unknown) => RecoverySlotMutation<T>,
  ) => Promise<RecoveryArtifactGuardedMutation<T>>;
  readonly getArtifact: (runId: string) => Promise<unknown>;
  /** Cheap durable-presence check used before a cached staged record is
   * allowed to arm or activate slots. */
  readonly artifactExists: (runId: string) => Promise<boolean>;
  /** Atomically inserts an immutable run artifact; false means runId exists. */
  readonly putArtifact: (record: StoredRecoveryArtifact) => Promise<boolean>;
  readonly deleteArtifact: (runId: string) => Promise<void>;
  /** Deletes only when a transaction-time slot read is unreferenced and the
   * durable artifact still matches the caller's lifecycle generation/token. */
  readonly deleteArtifactIfUnreferenced: (
    runId: string,
    guard: RecoveryArtifactDeleteGuard,
  ) => Promise<boolean>;
  readonly deleteArtifactsExcept: (
    retainedRunIds: ReadonlySet<string>,
    stagingBoundary?: RecoveryArtifactStagingBoundary,
  ) => Promise<number | null>;
  readonly purge: (generation: number) => Promise<void>;
};

export type RecoveryArtifactGuardedMutation<T> =
  | { readonly artifactExists: false }
  | { readonly artifactExists: true; readonly value: T };

export type RecoveryArtifactStagingBoundary = {
  readonly generation: number;
};

export type RecoveryArtifactDeleteGuard = {
  readonly generation: number;
  readonly stagingLeaseExpiresAtEpochMs?: number;
};

export type MemoryRecoveryBackendOperation =
  | 'read-slots'
  | 'mutate-slots'
  | 'get-artifact'
  | 'put-artifact'
  | 'delete-artifact'
  | 'cleanup-artifacts'
  | 'purge';

export class MemoryRecoveryStorageBackend implements RecoveryStorageBackend {
  private slots: unknown = null;
  private readonly artifacts = new Map<string, unknown>();
  private readonly failures = new Set<MemoryRecoveryBackendOperation>();

  failNext(operation: MemoryRecoveryBackendOperation): void {
    this.failures.add(operation);
  }

  async readSlots(): Promise<unknown> {
    this.maybeFail('read-slots');
    return clone(this.slots);
  }

  async mutateSlots<T>(mutate: (current: unknown) => RecoverySlotMutation<T>): Promise<T> {
    this.maybeFail('mutate-slots');
    const mutation = mutate(clone(this.slots));
    this.slots = clone(mutation.slots);
    return mutation.value;
  }

  async mutateSlotsWithArtifact<T>(
    runId: string,
    mutate: (current: unknown) => RecoverySlotMutation<T>,
  ): Promise<RecoveryArtifactGuardedMutation<T>> {
    this.maybeFail('mutate-slots');
    if (!this.artifacts.has(runId)) return { artifactExists: false };
    const mutation = mutate(clone(this.slots));
    this.slots = clone(mutation.slots);
    return { artifactExists: true, value: mutation.value };
  }

  async getArtifact(runId: string): Promise<unknown> {
    this.maybeFail('get-artifact');
    return clone(this.artifacts.get(runId) ?? null);
  }

  async artifactExists(runId: string): Promise<boolean> {
    this.maybeFail('get-artifact');
    return this.artifacts.has(runId);
  }

  async putArtifact(record: StoredRecoveryArtifact): Promise<boolean> {
    this.maybeFail('put-artifact');
    if (this.artifacts.has(record.runId)) return false;
    this.artifacts.set(record.runId, clone(record));
    return true;
  }

  async deleteArtifact(runId: string): Promise<void> {
    this.maybeFail('delete-artifact');
    this.artifacts.delete(runId);
  }

  async deleteArtifactIfUnreferenced(
    runId: string,
    guard: RecoveryArtifactDeleteGuard,
  ): Promise<boolean> {
    this.maybeFail('delete-artifact');
    if (persistedRecoveryArtifactRunIds(this.slots, guard.generation).has(runId)) return false;
    const artifact = this.artifacts.get(runId);
    if (!artifactMatchesDeleteGuard(artifact, guard)) return false;
    this.artifacts.delete(runId);
    return true;
  }

  async deleteArtifactsExcept(
    retainedRunIds: ReadonlySet<string>,
    stagingBoundary?: RecoveryArtifactStagingBoundary,
  ): Promise<number | null> {
    this.maybeFail('cleanup-artifacts');
    const liveRetained = stagingBoundary?.generation;
    const retained = new Set(retainedRunIds);
    if (liveRetained !== undefined) {
      for (const runId of persistedRecoveryArtifactRunIds(this.slots, liveRetained)) {
        retained.add(runId);
      }
    }
    let retryAtEpochMs: number | null = null;
    for (const [runId, artifact] of this.artifacts) {
      if (retained.has(runId)) continue;
      const leaseExpiry = stagingLeaseExpiry(artifact, stagingBoundary);
      if (leaseExpiry === null) this.artifacts.delete(runId);
      else retryAtEpochMs = earliestEpoch(retryAtEpochMs, leaseExpiry);
    }
    return retryAtEpochMs;
  }

  async purge(generation: number): Promise<void> {
    this.maybeFail('purge');
    this.artifacts.clear();
    this.slots = emptyRecoverySlots(generation);
  }

  private maybeFail(operation: MemoryRecoveryBackendOperation): void {
    if (!this.failures.delete(operation)) return;
    throw new Error(`Injected ${operation} failure.`);
  }
}

function stagingLeaseExpiry(
  artifact: unknown,
  boundary: RecoveryArtifactStagingBoundary | undefined,
): number | null {
  return boundary === undefined
    ? null
    : activeStoredArtifactStagingLeaseExpiry(artifact, boundary.generation, Date.now());
}

function earliestEpoch(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate);
}

export function artifactMatchesDeleteGuard(
  value: unknown,
  guard: RecoveryArtifactDeleteGuard,
): boolean {
  const record = validStoredArtifact(value);
  return (
    record?.generation === guard.generation &&
    (guard.stagingLeaseExpiresAtEpochMs === undefined ||
      record.stagingLeaseExpiresAtEpochMs === guard.stagingLeaseExpiresAtEpochMs)
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
