import {
  isCurrentExecutionArtifact,
  isExecutionArtifact,
  type ExecutionArtifactV1,
  type RunId,
} from './execution-artifact';
import {
  executionArtifactIntegrityIsValid,
  storedExecutionArtifactIntegrityIsValid,
} from './execution-artifact-integrity';
import { matchesStoredArtifact } from './recovery-artifact-identity';
import {
  estimateExecutionArtifactBytes,
  MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES,
} from './execution-artifact-size';
import { recoverySnapshotReferencesRun } from './recovery-artifact-cleanup';
import { STAGED_ARTIFACT_LEASE_MS } from './recovery-artifact-staging';
import type { RecoveryStorageBackend } from './recovery-backend';
import {
  validStoredArtifact,
  CURRENT_EXECUTION_ARTIFACT_ORIGIN,
  type RecoveryRepositoryResult,
  type RecoveryRepositorySnapshot,
  type StoredRecoveryArtifact,
} from './recovery-model';
import { recoveryFailure as failure, recoveryOk as ok } from './recovery-result';

type ArtifactStoreHost = {
  readonly backend: RecoveryStorageBackend;
  readonly currentGeneration: () => number;
  readonly ensureLoaded: () => Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>>;
  readonly snapshot: () => RecoveryRepositorySnapshot;
  readonly noteStaged: (runId: RunId) => void;
  readonly discardStaged: (runId: RunId) => void;
  readonly storageFailure: <T>(operation: string, error: unknown) => RecoveryRepositoryResult<T>;
};

export class RecoveryArtifactStore {
  private readonly stagedRecords = new Map<RunId, StoredRecoveryArtifact>();

  constructor(private readonly host: ArtifactStoreHost) {}

  clear(): void {
    this.stagedRecords.clear();
  }

  releaseStaged(runId: RunId): void {
    this.stagedRecords.delete(runId);
  }

  async stage(artifact: ExecutionArtifactV1): Promise<RecoveryRepositoryResult<RunId>> {
    if (
      !isCurrentExecutionArtifact(artifact) ||
      !artifactFitsArchiveBudget(artifact) ||
      !(await executionArtifactIntegrityIsValid(artifact))
    ) {
      return failure('conflict');
    }
    const ready = await this.host.ensureLoaded();
    if (!ready.ok) return ready;
    // Integrity and repository loading both yield. Recompute immediately before
    // persistence so a caller cannot grow a mutable extra during either await.
    if (!artifactFitsArchiveBudget(artifact)) return failure('conflict');
    try {
      const generation = this.host.currentGeneration();
      const priorStaged = this.stagedRecords.get(artifact.runId);
      const record: StoredRecoveryArtifact = {
        runId: artifact.runId,
        generation,
        origin: CURRENT_EXECUTION_ARTIFACT_ORIGIN,
        stagingLeaseExpiresAtEpochMs: Date.now() + STAGED_ARTIFACT_LEASE_MS,
        artifact,
      };
      const inserted = await this.host.backend.putArtifact(record);
      if (!inserted && !(await matchesStoredArtifact(this.host.backend, generation, artifact))) {
        return failure('conflict');
      }
      if (inserted) this.stagedRecords.set(artifact.runId, record);
      else if (priorStaged?.generation !== generation) this.stagedRecords.delete(artifact.runId);
      this.host.noteStaged(artifact.runId);
      return ok(artifact.runId);
    } catch (error) {
      return this.host.storageFailure('stage job recovery artifact', error);
    }
  }

  async discard(runId: RunId): Promise<RecoveryRepositoryResult<boolean>> {
    const staged = this.stagedRecords.get(runId);
    this.host.discardStaged(runId);
    try {
      if (recoverySnapshotReferencesRun(this.host.snapshot(), runId)) {
        this.releaseStaged(runId);
        return ok(false);
      }
      if (staged === undefined) return ok(false);
      const deleted = await this.host.backend.deleteArtifactIfUnreferenced(runId, {
        generation: staged.generation,
        ...(staged.stagingLeaseExpiresAtEpochMs === undefined
          ? {}
          : { stagingLeaseExpiresAtEpochMs: staged.stagingLeaseExpiresAtEpochMs }),
      });
      this.releaseStaged(runId);
      return ok(deleted);
    } catch (error) {
      return this.host.storageFailure('discard staged recovery artifact', error);
    }
  }

  async exact(runId: RunId): Promise<RecoveryRepositoryResult<StoredRecoveryArtifact>> {
    const ready = await this.host.ensureLoaded();
    if (!ready.ok) return ready;
    try {
      const generation = this.host.currentGeneration();
      const staged = this.stagedRecords.get(runId);
      if (staged?.generation === generation) {
        if (await this.host.backend.artifactExists(runId)) return ok(staged);
        this.stagedRecords.delete(runId);
        this.host.discardStaged(runId);
        return failure('not-found');
      }
      if (staged !== undefined) this.stagedRecords.delete(runId);
      const record = validStoredArtifact(await this.host.backend.getArtifact(runId));
      if (
        record === null ||
        record.generation !== generation ||
        !isExecutionArtifact(record.artifact) ||
        !(await storedExecutionArtifactIntegrityIsValid(record))
      ) {
        return failure('not-found');
      }
      return ok(record);
    } catch (error) {
      return this.host.storageFailure('read job recovery artifact', error);
    }
  }

  async archived(runId: RunId): Promise<RecoveryRepositoryResult<ExecutionArtifactV1>> {
    const ready = await this.host.ensureLoaded();
    if (!ready.ok) return ready;
    if (!this.host.snapshot().executionHistory.some((record) => record.runId === runId)) {
      return failure('not-found');
    }
    const record = await this.exact(runId);
    return record.ok && isCurrentExecutionArtifact(record.value.artifact)
      ? ok(record.value.artifact)
      : failure('not-found');
  }
}

function artifactFitsArchiveBudget(artifact: ExecutionArtifactV1): boolean {
  return (
    estimateExecutionArtifactBytes(artifact, MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES) <=
    MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES
  );
}
