import type { RunId } from './execution-artifact';
import type { ExecutionHistoryRecord, PersistedRecoverySlots } from './recovery-model';

export const MAX_EXECUTION_HISTORY_RUNS = 20;
export const MAX_EXECUTION_HISTORY_ESTIMATED_BYTES = 100 * 1024 * 1024;

export type ExecutionHistoryLimits = {
  readonly maxRuns: number;
  readonly maxEstimatedBytes: number;
};

const DEFAULT_LIMITS: ExecutionHistoryLimits = {
  maxRuns: MAX_EXECUTION_HISTORY_RUNS,
  maxEstimatedBytes: MAX_EXECUTION_HISTORY_ESTIMATED_BYTES,
};

/** Append/replace one terminal record, then prune oldest unprotected records.
 * Recovery-owned and replay-owned runs may temporarily exceed the limits; they
 * are never deleted merely to satisfy audit retention. */
export function appendBoundedExecutionHistory(
  slots: PersistedRecoverySlots,
  record: ExecutionHistoryRecord,
  limits: ExecutionHistoryLimits = DEFAULT_LIMITS,
): ReadonlyArray<ExecutionHistoryRecord> {
  const records = [...slots.executionHistory.filter((item) => item.runId !== record.runId), record];
  const protectedRunIds = protectedRuns(slots, record.runId);
  return boundExecutionHistory(records, protectedRunIds, limits);
}

/** Apply retention limits to already persisted records. The newest record and
 * explicit recovery/replay owners remain available even when one record alone
 * exceeds the ordinary byte cap. */
export function boundExecutionHistory(
  records: ReadonlyArray<ExecutionHistoryRecord>,
  protectedRunIds: ReadonlySet<RunId> = new Set(),
  limits: ExecutionHistoryLimits = DEFAULT_LIMITS,
): ReadonlyArray<ExecutionHistoryRecord> {
  const protectedIds = new Set(protectedRunIds);
  const newest = records.at(-1);
  if (newest !== undefined) protectedIds.add(newest.runId);
  let retainedCount = 0;
  let retainedBytes = 0;
  const retainedNewestFirst: ExecutionHistoryRecord[] = [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const item = records[index];
    if (item === undefined) continue;
    const protectedRecord = protectedIds.has(item.runId);
    const withinCount = retainedCount < limits.maxRuns;
    const withinBytes = retainedBytes + item.estimatedArtifactBytes <= limits.maxEstimatedBytes;
    if (!protectedRecord && (!withinCount || !withinBytes)) continue;
    retainedNewestFirst.push(item);
    retainedCount += 1;
    retainedBytes += item.estimatedArtifactBytes;
  }
  return retainedNewestFirst.reverse();
}

function protectedRuns(slots: PersistedRecoverySlots, newestRunId: RunId): ReadonlySet<RunId> {
  const runIds = new Set<RunId>([newestRunId]);
  if (slots.activeRun !== null) runIds.add(slots.activeRun.runId);
  if (slots.recoveryCapsule !== null) runIds.add(slots.recoveryCapsule.runId);
  if (slots.pendingStart !== null) runIds.add(slots.pendingStart.runId);
  if (slots.pendingStart?.sourceRecovery !== undefined) {
    runIds.add(slots.pendingStart.sourceRecovery.runId);
  }
  return runIds;
}
