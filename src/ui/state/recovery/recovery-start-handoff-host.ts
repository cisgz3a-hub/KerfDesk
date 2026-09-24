// Wiring for RecoveryStartHandoff, lifted out of the repository constructor
// when ADR-337 gave the handoff a second collaborator (the intent stand-in
// writer) and the class reached its line budget. Behaviour-free: every field
// forwards to something the repository already owns, or commits one slot
// mutation through the backend it already holds.

import type { JobCheckpoint } from '../../../core/recovery';
import type { RecoveryArtifactV1, RunId } from './execution-artifact';
import { putStartIntentStandIn } from './recovery-legacy-insert';
import { commitRecoverySlotMutation } from './recovery-mutation-commit';
import { RecoveryStartHandoff } from './recovery-start-handoff';
import type { RecoveryStorageBackend } from './recovery-backend';
import type {
  PersistedRecoverySlots,
  RecoveryRepositoryResult,
  RecoveryRepositorySnapshot,
  StoredRecoveryArtifact,
} from './recovery-model';

export type StartHandoffHostDeps = {
  readonly backend: RecoveryStorageBackend;
  readonly nowIso: () => string;
  readonly getSnapshot: () => RecoveryRepositorySnapshot;
  readonly artifactStore: {
    readonly exact: (runId: RunId) => Promise<RecoveryRepositoryResult<StoredRecoveryArtifact>>;
  };
  readonly currentGeneration: () => number;
  readonly mutate: <T>(
    operation: string,
    mutate: (slots: PersistedRecoverySlots) => {
      readonly slots: PersistedRecoverySlots;
      readonly value: T;
    },
    requiredArtifactRunId?: RunId,
  ) => Promise<RecoveryRepositoryResult<T>>;
  readonly refresh: () => Promise<RecoveryRepositoryResult<RecoveryRepositorySnapshot>>;
  readonly onFailure: (operation: string, error: unknown) => void;
};

export function createStartHandoff(deps: StartHandoffHostDeps): RecoveryStartHandoff {
  return new RecoveryStartHandoff({
    nowIso: deps.nowIso,
    getSnapshot: deps.getSnapshot,
    exactArtifactRecord: (runId: RunId) => deps.artifactStore.exact(runId),
    mutate: deps.mutate,
    // A renewal is a liveness write, like progress: committed alone, with no
    // local reload and no announcement making every other window reload.
    renewLease: async (mutate) => {
      const committed = await commitRecoverySlotMutation({
        backend: deps.backend,
        minimumGeneration: deps.currentGeneration(),
        mutate,
      });
      return committed.artifactExists && committed.value;
    },
    refresh: deps.refresh,
    materializeIntentArtifact: (
      runId: RunId,
      intent: JobCheckpoint,
    ): Promise<RecoveryArtifactV1['kind'] | null> =>
      putStartIntentStandIn({
        backend: deps.backend,
        generation: deps.currentGeneration(),
        nowIso: deps.nowIso,
        onFailure: (error) => deps.onFailure('materialize interrupted Start intent', error),
        runId,
        intent,
      }),
  });
}
