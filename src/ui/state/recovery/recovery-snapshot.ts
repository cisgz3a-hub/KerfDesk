import {
  isExecutionArtifact,
  isRecoveryArtifact,
  type RecoveryArtifactV1,
} from './execution-artifact';
import type { RecoveryStorageBackend } from './recovery-backend';
import {
  validStoredArtifact,
  type PersistedRecoverySlots,
  type RecoveryRepositorySnapshot,
} from './recovery-model';

export async function hydrateRecoverySnapshot(
  backend: RecoveryStorageBackend,
  slots: PersistedRecoverySlots,
): Promise<RecoveryRepositorySnapshot> {
  const records = await artifactMap(backend, slots);
  const activeArtifact = artifactFor(records, slots.activeRun?.runId);
  const recoveryArtifact = artifactFor(records, slots.recoveryCapsule?.runId);
  const completedArtifact = artifactFor(records, slots.lastCompletedReceipt?.runId);
  return {
    loaded: true,
    generation: slots.generation,
    activeRun:
      slots.activeRun !== null && isExecutionArtifact(activeArtifact)
        ? { ...slots.activeRun, artifact: activeArtifact }
        : null,
    recoveryCapsule: hydratedRecoveryCapsule(slots, recoveryArtifact),
    lastCompletedReceipt:
      slots.lastCompletedReceipt !== null && isExecutionArtifact(completedArtifact)
        ? { ...slots.lastCompletedReceipt, artifact: completedArtifact }
        : null,
  };
}

async function artifactMap(
  backend: RecoveryStorageBackend,
  slots: PersistedRecoverySlots,
): Promise<ReadonlyMap<string, RecoveryArtifactV1>> {
  const records = new Map<string, RecoveryArtifactV1>();
  const runIds = new Set(
    [
      slots.activeRun?.runId,
      slots.recoveryCapsule?.runId,
      slots.lastCompletedReceipt?.runId,
    ].filter((value): value is string => value !== undefined),
  );
  await Promise.all(
    [...runIds].map(async (runId) => {
      const stored = validStoredArtifact(await backend.getArtifact(runId));
      if (
        stored !== null &&
        stored.generation === slots.generation &&
        isRecoveryArtifact(stored.artifact)
      ) {
        records.set(runId, stored.artifact);
      }
    }),
  );
  return records;
}

function hydratedRecoveryCapsule(
  slots: PersistedRecoverySlots,
  artifact: RecoveryArtifactV1 | null,
): RecoveryRepositorySnapshot['recoveryCapsule'] {
  const capsule = slots.recoveryCapsule;
  if (capsule === null || !isRecoveryArtifact(artifact)) return null;
  return artifact.kind === capsule.artifactKind ? { ...capsule, artifact } : null;
}

function artifactFor(
  records: ReadonlyMap<string, RecoveryArtifactV1>,
  runId: string | undefined,
): RecoveryArtifactV1 | null {
  return runId === undefined ? null : (records.get(runId) ?? null);
}
