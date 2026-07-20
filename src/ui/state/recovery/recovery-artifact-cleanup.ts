import type { RunId } from './execution-artifact';
import type { RecoveryStorageBackend } from './recovery-backend';
import type { RecoveryRepositorySnapshot } from './recovery-model';

export async function cleanupDisplacedRecoveryArtifacts(args: {
  readonly backend: RecoveryStorageBackend;
  readonly before: RecoveryRepositorySnapshot;
  readonly after: RecoveryRepositorySnapshot;
  readonly retryRunIds?: ReadonlySet<RunId>;
  readonly isStaged: (runId: RunId) => boolean;
  readonly onFailure: (runId: RunId, error: unknown) => void;
}): Promise<ReadonlySet<RunId>> {
  const retained = recoverySnapshotRunIds(args.after);
  const candidates = recoverySnapshotRunIds(args.before);
  for (const runId of args.retryRunIds ?? []) candidates.add(runId);
  const failed = new Set<RunId>();
  for (const runId of candidates) {
    if (retained.has(runId) || args.isStaged(runId)) continue;
    try {
      await args.backend.deleteArtifactIfUnreferenced(runId, {
        generation: args.after.generation,
      });
    } catch (error) {
      failed.add(runId);
      args.onFailure(runId, error);
    }
  }
  return failed;
}

export function recoverySnapshotReferencesRun(
  snapshot: RecoveryRepositorySnapshot,
  runId: RunId,
): boolean {
  return recoverySnapshotRunIds(snapshot).has(runId);
}

export function recoverySnapshotRunIds(snapshot: RecoveryRepositorySnapshot): Set<RunId> {
  const runIds = new Set<RunId>();
  if (snapshot.activeRun !== null) runIds.add(snapshot.activeRun.runId);
  if (snapshot.recoveryCapsule !== null) runIds.add(snapshot.recoveryCapsule.runId);
  if (snapshot.lastCompletedReceipt !== null) runIds.add(snapshot.lastCompletedReceipt.runId);
  if (snapshot.pendingStart !== null) runIds.add(snapshot.pendingStart.runId);
  if (snapshot.pendingStart?.sourceRecovery !== undefined) {
    runIds.add(snapshot.pendingStart.sourceRecovery.runId);
  }
  for (const record of snapshot.executionHistory) runIds.add(record.runId);
  return runIds;
}
