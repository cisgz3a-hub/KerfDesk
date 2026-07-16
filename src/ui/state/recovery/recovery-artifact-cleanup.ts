import type { RunId } from './execution-artifact';
import type { RecoveryStorageBackend } from './recovery-backend';
import type { RecoveryRepositorySnapshot } from './recovery-model';

export async function cleanupDisplacedRecoveryArtifacts(args: {
  readonly backend: RecoveryStorageBackend;
  readonly before: RecoveryRepositorySnapshot;
  readonly after: RecoveryRepositorySnapshot;
  readonly isStaged: (runId: RunId) => boolean;
  readonly onFailure: (error: unknown) => void;
}): Promise<void> {
  const retained = referencedRunIds(args.after);
  for (const runId of referencedRunIds(args.before)) {
    if (retained.has(runId) || args.isStaged(runId)) continue;
    try {
      await args.backend.deleteArtifact(runId);
    } catch (error) {
      args.onFailure(error);
    }
  }
}

export function recoverySnapshotReferencesRun(
  snapshot: RecoveryRepositorySnapshot,
  runId: RunId,
): boolean {
  return referencedRunIds(snapshot).has(runId);
}

function referencedRunIds(snapshot: RecoveryRepositorySnapshot): Set<RunId> {
  const runIds = new Set<RunId>();
  if (snapshot.activeRun !== null) runIds.add(snapshot.activeRun.runId);
  if (snapshot.recoveryCapsule !== null) runIds.add(snapshot.recoveryCapsule.runId);
  if (snapshot.lastCompletedReceipt !== null) runIds.add(snapshot.lastCompletedReceipt.runId);
  if (snapshot.pendingStart !== null) runIds.add(snapshot.pendingStart.runId);
  if (snapshot.pendingStart?.sourceRecovery !== undefined) {
    runIds.add(snapshot.pendingStart.sourceRecovery.runId);
  }
  return runIds;
}
