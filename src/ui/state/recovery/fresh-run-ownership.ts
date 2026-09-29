import type { RunId } from './execution-artifact';
import type { RecoveryRepositorySnapshot, PersistedRecoverySlots } from './recovery-model';

export function freshRunGuard(
  before: RecoveryRepositorySnapshot,
  runId: RunId,
  current?: () => boolean,
) {
  return current === undefined
    ? undefined
    : (slots: PersistedRecoverySlots) =>
        current() && freshRunOwnershipMatches(slots, before, runId);
}

/** Fresh Start may replace the prior receipt/capsule, never a later owner. */
export function freshRunOwnershipMatches(
  current: RecoveryRepositorySnapshot | PersistedRecoverySlots,
  before: RecoveryRepositorySnapshot,
  runId: RunId | undefined,
): boolean {
  return (
    current.generation === before.generation &&
    (['pendingStart', 'activeRun'] as const).every(
      (key) => current[key] === null || current[key].runId === runId,
    ) &&
    (['lastCompletedReceipt', 'recoveryCapsule'] as const).every(
      (key) =>
        current[key] === null ||
        current[key].runId === runId ||
        current[key].runId === before[key]?.runId,
    )
  );
}
