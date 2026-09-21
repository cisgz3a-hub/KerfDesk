import type { RecoveryRepository, RunId } from '../state/recovery';

type Snapshot = ReturnType<RecoveryRepository['getSnapshot']>;

export type CheckpointArchiveHandoff = {
  readonly runId: RunId;
  readonly generation: number;
  readonly armedAtIso: string;
};

/** A successful terminal no-op is expected before this accepted run's archive
 * activates. Replaced handoffs and generation resets are not that transient case. */
export function pendingCheckpointArchiveHandoff(
  repository: RecoveryRepository,
  before: Snapshot,
  runId: RunId,
  activated: CheckpointArchiveHandoff | null,
): CheckpointArchiveHandoff | null {
  if (before.pendingStart?.runId !== runId) return null;
  const pending = {
    runId,
    generation: before.generation,
    armedAtIso: before.pendingStart.armedAtIso,
  };
  return checkpointArchiveHandoffIsCurrent(repository, pending, activated) ? pending : null;
}

export function checkpointArchiveHandoffIsCurrent(
  repository: RecoveryRepository,
  pending: CheckpointArchiveHandoff,
  activated: CheckpointArchiveHandoff | null,
): boolean {
  const after = repository.getSnapshot();
  return (
    after.generation === pending.generation &&
    ((after.pendingStart?.runId === pending.runId &&
      after.pendingStart.armedAtIso === pending.armedAtIso) ||
      (after.activeRun?.runId === pending.runId && sameArchiveHandoff(activated, pending)))
  );
}

function sameArchiveHandoff(
  activated: CheckpointArchiveHandoff | null,
  pending: CheckpointArchiveHandoff,
): boolean {
  return (
    activated?.runId === pending.runId &&
    activated.generation === pending.generation &&
    activated.armedAtIso === pending.armedAtIso
  );
}

/** Watch only pending-intent activation, not refreshes caused by tracker writes.
 * Run Again has no Frame-claim cleanup and can have no further controller input. */
export function subscribeCheckpointArchiveActivation(
  repository: RecoveryRepository,
  onActivated: (handoff: CheckpointArchiveHandoff) => void,
): () => void {
  let previous = repository.getSnapshot();
  return repository.subscribe(() => {
    const before = previous;
    const after = repository.getSnapshot();
    previous = after;
    const pending = before.pendingStart;
    if (
      pending !== null &&
      before.generation === after.generation &&
      after.activeRun?.runId === pending.runId
    )
      onActivated({
        runId: pending.runId,
        generation: before.generation,
        armedAtIso: pending.armedAtIso,
      });
  });
}
