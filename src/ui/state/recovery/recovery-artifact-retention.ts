import { parseRecoverySlots } from './recovery-model';

export function persistedRecoveryArtifactRunIds(
  rawSlots: unknown,
  minimumGeneration: number,
): Set<string> {
  const slots = parseRecoverySlots(rawSlots, minimumGeneration).slots;
  const runIds = new Set<string>();
  if (slots.activeRun !== null) runIds.add(slots.activeRun.runId);
  if (slots.recoveryCapsule !== null) runIds.add(slots.recoveryCapsule.runId);
  if (slots.lastCompletedReceipt !== null) runIds.add(slots.lastCompletedReceipt.runId);
  if (slots.pendingStart !== null) runIds.add(slots.pendingStart.runId);
  if (slots.pendingStart?.sourceRecovery !== undefined) {
    runIds.add(slots.pendingStart.sourceRecovery.runId);
  }
  for (const record of slots.executionHistory) runIds.add(record.runId);
  return runIds;
}
