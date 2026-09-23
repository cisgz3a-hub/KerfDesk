import {
  executionArtifactIsCurrent,
  isExecutionArtifact,
  isLegacyFingerprintArtifact,
  type ExecutionArtifactV1,
  type RecoveryArtifactV1,
} from './execution-artifact';
import { memoizedExecutionArtifactBytes } from './execution-artifact-size';
import { storedExecutionArtifactIntegrityIsValid } from './execution-artifact-integrity';
import { boundExecutionHistory } from './execution-history';
import type { RecoveryStorageBackend } from './recovery-backend';
import {
  validStoredArtifact,
  type ExecutionHistoryRecord,
  type PersistedRecoverySlots,
  type RecoveryRepositorySnapshot,
} from './recovery-model';

export async function hydrateRecoverySnapshot(
  backend: RecoveryStorageBackend,
  slots: PersistedRecoverySlots,
): Promise<RecoveryRepositorySnapshot> {
  return (await hydrateRecoveryState(backend, slots)).snapshot;
}

export type HydratedRecoveryState = {
  readonly snapshot: RecoveryRepositorySnapshot;
  readonly artifacts: ReadonlyMap<string, RecoveryArtifactV1>;
};

export async function hydrateRecoveryState(
  backend: RecoveryStorageBackend,
  slots: PersistedRecoverySlots,
  knownArtifacts: ReadonlyMap<string, RecoveryArtifactV1> = new Map(),
): Promise<HydratedRecoveryState> {
  const records = await artifactMap(backend, slots, knownArtifacts);
  const activeArtifact = artifactFor(records, slots.activeRun?.runId);
  const recoveryArtifact = artifactFor(records, slots.recoveryCapsule?.runId);
  const completedArtifact = artifactFor(records, slots.lastCompletedReceipt?.runId);
  const executionHistory = hydratedExecutionHistory(slots, records);
  return {
    artifacts: records,
    snapshot: {
      loaded: true,
      generation: slots.generation,
      activeRun:
        slots.activeRun !== null &&
        isValidatedExecutionArtifact(activeArtifact) &&
        progressMatchesArtifact(slots.activeRun, activeArtifact)
          ? { ...slots.activeRun, artifact: activeArtifact }
          : null,
      recoveryCapsule: hydratedRecoveryCapsule(slots, recoveryArtifact),
      lastCompletedReceipt:
        slots.lastCompletedReceipt !== null && isValidatedExecutionArtifact(completedArtifact)
          ? { ...slots.lastCompletedReceipt, artifact: completedArtifact }
          : null,
      pendingStart: slots.pendingStart,
      executionHistory,
    },
  };
}

async function artifactMap(
  backend: RecoveryStorageBackend,
  slots: PersistedRecoverySlots,
  knownArtifacts: ReadonlyMap<string, RecoveryArtifactV1>,
): Promise<ReadonlyMap<string, RecoveryArtifactV1>> {
  const records = new Map<string, RecoveryArtifactV1>();
  const runIds = new Set(
    [
      slots.activeRun?.runId,
      slots.recoveryCapsule?.runId,
      slots.lastCompletedReceipt?.runId,
      slots.pendingStart?.runId,
      slots.pendingStart?.sourceRecovery?.runId,
      ...slots.executionHistory.map((record) => record.runId),
    ].filter((value): value is string => value !== undefined),
  );
  for (const runId of runIds) {
    const known = knownArtifacts.get(runId);
    if (knownArtifactCanHydrate(known, runId)) records.set(runId, known);
  }
  await Promise.all(
    [...runIds]
      .filter((runId) => !records.has(runId))
      .map(async (runId) => {
        const stored = validStoredArtifact(await backend.getArtifact(runId));
        if (
          stored !== null &&
          stored.generation === slots.generation &&
          isValidatedRecoveryArtifact(stored.artifact) &&
          (stored.artifact.kind === 'legacy-fingerprint-only' ||
            (await storedExecutionArtifactIntegrityIsValid(stored)))
        ) {
          records.set(runId, stored.artifact);
        }
      }),
  );
  return records;
}

function knownArtifactCanHydrate(
  artifact: RecoveryArtifactV1 | undefined,
  runId: string,
): artifact is RecoveryArtifactV1 {
  return (
    artifact?.runId === runId &&
    isValidatedRecoveryArtifact(artifact) &&
    (artifact.kind === 'legacy-fingerprint-only' || executionArtifactIsCurrent(artifact))
  );
}

// Hydrated artifacts are immutable, and the coordinator hands the same
// references back on every refresh. Full validation fingerprints the whole
// program text, so it runs once per artifact identity instead of two or three
// times per retained run on every refresh.
const validatedExecutionArtifacts = new WeakSet<object>();

function isValidatedExecutionArtifact(value: unknown): value is ExecutionArtifactV1 {
  if (typeof value === 'object' && value !== null && validatedExecutionArtifacts.has(value)) {
    return true;
  }
  if (!isExecutionArtifact(value)) return false;
  validatedExecutionArtifacts.add(value);
  return true;
}

function isValidatedRecoveryArtifact(value: unknown): value is RecoveryArtifactV1 {
  return isValidatedExecutionArtifact(value) || isLegacyFingerprintArtifact(value);
}

function hydratedExecutionHistory(
  slots: PersistedRecoverySlots,
  records: ReadonlyMap<string, RecoveryArtifactV1>,
): ReadonlyArray<ExecutionHistoryRecord> {
  const seen = new Set<string>();
  const newestUnique: ExecutionHistoryRecord[] = [];
  for (let index = slots.executionHistory.length - 1; index >= 0; index -= 1) {
    const record = slots.executionHistory[index];
    if (record === undefined || seen.has(record.runId)) continue;
    seen.add(record.runId);
    const artifact = artifactFor(records, record.runId);
    if (!isValidatedExecutionArtifact(artifact) || !progressMatchesArtifact(record, artifact)) {
      continue;
    }
    newestUnique.push({
      ...record,
      // Same measurement as before, cached on the artifact's identity: the
      // persisted record's byte count is mutable, so retention must still be
      // decided from the artifact itself, but the artifact is immutable and
      // the coordinator hands the same references back on every refresh.
      estimatedArtifactBytes: memoizedExecutionArtifactBytes(artifact),
    });
  }
  newestUnique.reverse();
  return boundExecutionHistory(newestUnique, protectedHistoryRunIds(slots));
}

function protectedHistoryRunIds(slots: PersistedRecoverySlots): ReadonlySet<string> {
  const runIds = new Set<string>();
  if (slots.activeRun !== null) runIds.add(slots.activeRun.runId);
  if (slots.recoveryCapsule !== null) runIds.add(slots.recoveryCapsule.runId);
  if (slots.lastCompletedReceipt !== null) runIds.add(slots.lastCompletedReceipt.runId);
  if (slots.pendingStart !== null) runIds.add(slots.pendingStart.runId);
  if (slots.pendingStart?.sourceRecovery !== undefined) {
    runIds.add(slots.pendingStart.sourceRecovery.runId);
  }
  return runIds;
}

function hydratedRecoveryCapsule(
  slots: PersistedRecoverySlots,
  artifact: RecoveryArtifactV1 | null,
): RecoveryRepositorySnapshot['recoveryCapsule'] {
  const capsule = slots.recoveryCapsule;
  if (capsule === null || !isValidatedRecoveryArtifact(artifact)) return null;
  return artifact.kind === capsule.artifactKind && progressMatchesArtifact(capsule, artifact)
    ? { ...capsule, artifact }
    : null;
}

function progressMatchesArtifact(
  progress: { readonly sendableLines: number },
  artifact: RecoveryArtifactV1,
): boolean {
  return progress.sendableLines === artifact.sendableLines;
}

function artifactFor(
  records: ReadonlyMap<string, RecoveryArtifactV1>,
  runId: string | undefined,
): RecoveryArtifactV1 | null {
  return runId === undefined ? null : (records.get(runId) ?? null);
}
