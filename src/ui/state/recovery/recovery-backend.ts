import {
  emptyRecoverySlots,
  type PersistedRecoverySlots,
  type StoredRecoveryArtifact,
} from './recovery-model';

export type RecoverySlotMutation<T> = {
  readonly slots: PersistedRecoverySlots;
  readonly value: T;
};

export type RecoveryStorageBackend = {
  readonly readSlots: () => Promise<unknown>;
  readonly mutateSlots: <T>(mutate: (current: unknown) => RecoverySlotMutation<T>) => Promise<T>;
  readonly getArtifact: (runId: string) => Promise<unknown>;
  /** Atomically inserts an immutable run artifact; false means runId exists. */
  readonly putArtifact: (record: StoredRecoveryArtifact) => Promise<boolean>;
  readonly deleteArtifact: (runId: string) => Promise<void>;
  readonly deleteArtifactsExcept: (retainedRunIds: ReadonlySet<string>) => Promise<void>;
  readonly purge: (generation: number) => Promise<void>;
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

  async getArtifact(runId: string): Promise<unknown> {
    this.maybeFail('get-artifact');
    return clone(this.artifacts.get(runId) ?? null);
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

  async deleteArtifactsExcept(retainedRunIds: ReadonlySet<string>): Promise<void> {
    this.maybeFail('cleanup-artifacts');
    for (const runId of this.artifacts.keys()) {
      if (!retainedRunIds.has(runId)) this.artifacts.delete(runId);
    }
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

function clone<T>(value: T): T {
  return structuredClone(value);
}
