import type { PersistedRecoverySlots, RecoveryRepositorySnapshot } from './recovery-model';
import type { SlotMutation } from './recovery-slot-mutations';

export function sanitizeUnhydratedRecoveryReferences(
  snapshot: RecoveryRepositorySnapshot,
  expectedRevision: number | null,
): (slots: PersistedRecoverySlots) => SlotMutation<boolean> {
  return (slots) => sanitizeMutation(slots, snapshot, expectedRevision);
}

function sanitizeMutation(
  slots: PersistedRecoverySlots,
  snapshot: RecoveryRepositorySnapshot,
  expectedRevision: number | null,
): SlotMutation<boolean> {
  if (
    expectedRevision === null ||
    slots.generation !== snapshot.generation ||
    slots.revision !== expectedRevision
  ) {
    return { slots, value: false };
  }
  const historyRunIds = new Set(snapshot.executionHistory.map((record) => record.runId));
  const activeRun = matchingReference(slots.activeRun, snapshot.activeRun?.runId);
  const recoveryCapsule = matchingReference(slots.recoveryCapsule, snapshot.recoveryCapsule?.runId);
  const lastCompletedReceipt = matchingReference(
    slots.lastCompletedReceipt,
    snapshot.lastCompletedReceipt?.runId,
  );
  const executionHistory = slots.executionHistory.filter((record) =>
    historyRunIds.has(record.runId),
  );
  if (
    activeRun === slots.activeRun &&
    recoveryCapsule === slots.recoveryCapsule &&
    lastCompletedReceipt === slots.lastCompletedReceipt &&
    executionHistory.length === slots.executionHistory.length
  ) {
    return { slots, value: false };
  }
  return {
    slots: {
      ...slots,
      revision: slots.revision + 1,
      activeRun,
      recoveryCapsule,
      lastCompletedReceipt,
      executionHistory,
    },
    value: true,
  };
}

function matchingReference<T extends { readonly runId: string }>(
  persisted: T | null,
  hydratedRunId: string | undefined,
): T | null {
  return persisted?.runId === hydratedRunId ? persisted : null;
}
