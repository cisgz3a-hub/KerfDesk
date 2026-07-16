import { isExecutionArtifact, type ExecutionArtifactV1, type RunId } from './execution-artifact';
import { matchesStoredArtifact } from './recovery-artifact-identity';
import { recoverySnapshotReferencesRun } from './recovery-artifact-cleanup';
import type { RecoveryStorageBackend } from './recovery-backend';
import {
  validStoredArtifact,
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
  constructor(private readonly host: ArtifactStoreHost) {}

  async stage(artifact: ExecutionArtifactV1): Promise<RecoveryRepositoryResult<RunId>> {
    if (!isExecutionArtifact(artifact)) return failure('conflict');
    const ready = await this.host.ensureLoaded();
    if (!ready.ok) return ready;
    try {
      const generation = this.host.currentGeneration();
      const inserted = await this.host.backend.putArtifact({
        runId: artifact.runId,
        generation,
        artifact,
      });
      if (!inserted && !(await matchesStoredArtifact(this.host.backend, generation, artifact))) {
        return failure('conflict');
      }
      this.host.noteStaged(artifact.runId);
      return ok(artifact.runId);
    } catch (error) {
      return this.host.storageFailure('stage job recovery artifact', error);
    }
  }

  async discard(runId: RunId): Promise<RecoveryRepositoryResult<boolean>> {
    this.host.discardStaged(runId);
    try {
      if (recoverySnapshotReferencesRun(this.host.snapshot(), runId)) return ok(false);
      await this.host.backend.deleteArtifact(runId);
      return ok(true);
    } catch (error) {
      return this.host.storageFailure('discard staged recovery artifact', error);
    }
  }

  async exact(runId: RunId): Promise<RecoveryRepositoryResult<StoredRecoveryArtifact>> {
    const ready = await this.host.ensureLoaded();
    if (!ready.ok) return ready;
    try {
      const record = validStoredArtifact(await this.host.backend.getArtifact(runId));
      if (
        record === null ||
        record.generation !== this.host.currentGeneration() ||
        !isExecutionArtifact(record.artifact)
      ) {
        return failure('not-found');
      }
      return ok(record);
    } catch (error) {
      return this.host.storageFailure('read job recovery artifact', error);
    }
  }
}
