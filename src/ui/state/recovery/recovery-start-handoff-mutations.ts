import type { ExecutionArtifactV1, RunId } from './execution-artifact';
import type { PersistedRecoverySlots } from './recovery-model';
import type { SlotMutation } from './recovery-slot-mutations';

export function armFreshStartMutation(
  slots: PersistedRecoverySlots,
  artifact: ExecutionArtifactV1,
  artifactGeneration: number,
  armedAtIso: string,
): SlotMutation<boolean> {
  if (
    artifactGeneration !== slots.generation ||
    slots.pendingStart !== null ||
    slots.activeRun !== null
  ) {
    return unchanged(slots, false);
  }
  return {
    slots: {
      ...slots,
      revision: slots.revision + 1,
      pendingStart: {
        runId: artifact.runId,
        kind: 'fresh',
        sendableLines: artifact.sendableLines,
        armedAtIso,
      },
    },
    value: true,
  };
}

export function armClaimedRecoveryStartMutation(
  slots: PersistedRecoverySlots,
  args: {
    readonly sourceRunId: RunId;
    readonly sourceRevision: number;
    readonly attemptId: string;
    readonly artifact: ExecutionArtifactV1;
    readonly artifactGeneration: number;
    readonly armedAtIso: string;
  },
): SlotMutation<boolean> {
  const capsule = slots.recoveryCapsule;
  if (
    args.artifactGeneration !== slots.generation ||
    slots.pendingStart !== null ||
    slots.activeRun !== null ||
    capsule?.runId !== args.sourceRunId ||
    capsule.revision !== args.sourceRevision ||
    capsule.claim?.attemptId !== args.attemptId
  ) {
    return unchanged(slots, false);
  }
  return {
    slots: {
      ...slots,
      revision: slots.revision + 1,
      pendingStart: {
        runId: args.artifact.runId,
        kind: 'supervised-recovery',
        sendableLines: args.artifact.sendableLines,
        armedAtIso: args.armedAtIso,
        sourceRecovery: {
          runId: args.sourceRunId,
          revision: args.sourceRevision,
          attemptId: args.attemptId,
        },
      },
    },
    value: true,
  };
}

export function cancelPendingStartMutation(
  slots: PersistedRecoverySlots,
  runId: RunId,
): SlotMutation<boolean> {
  if (slots.pendingStart?.runId !== runId) return unchanged(slots, false);
  return {
    slots: { ...slots, revision: slots.revision + 1, pendingStart: null },
    value: true,
  };
}

export function reconcilePendingStartMutation(
  slots: PersistedRecoverySlots,
  updatedAtIso: string,
): SlotMutation<boolean> {
  const pending = slots.pendingStart;
  if (pending === null) return unchanged(slots, false);
  const revision = slots.revision + 1;
  return {
    slots: {
      ...slots,
      revision,
      activeRun: null,
      pendingStart: null,
      recoveryCapsule: {
        runId: pending.runId,
        artifactKind: 'exact-execution',
        revision,
        ackedLines: 0,
        sendableLines: pending.sendableLines,
        interruption: {
          kind: 'unknown',
          message:
            'The application restarted while Start was being accepted. Motion may or may not have begun.',
        },
        updatedAtIso,
      },
      lastCompletedReceipt: null,
    },
    value: true,
  };
}

function unchanged<T>(slots: PersistedRecoverySlots, value: T): SlotMutation<T> {
  return { slots, value };
}
