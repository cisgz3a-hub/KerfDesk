import type { JobCheckpoint } from '../../../core/recovery';
import type { ExecutionArtifactV1, RecoveryArtifactV1, RunId } from './execution-artifact';
import type { PersistedRecoverySlots } from './recovery-model';
import type { SlotMutation } from './recovery-slot-mutations';
import { START_INTENT_INTERRUPTION_MESSAGE as START_HANDOFF_UNCERTAIN_MESSAGE } from './start-intent';

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

/** ADR-337: arm a fresh Start from the intent alone, before the execution
 * archive exists. The guards are the artifact-backed ones minus the artifact:
 * one pending Start and one active run at a time. */
export function armFreshStartIntentMutation(
  slots: PersistedRecoverySlots,
  runId: RunId,
  intent: JobCheckpoint,
  armedAtIso: string,
): SlotMutation<boolean> {
  if (slots.pendingStart !== null || slots.activeRun !== null) {
    return unchanged(slots, false);
  }
  return {
    slots: {
      ...slots,
      revision: slots.revision + 1,
      pendingStart: {
        runId,
        kind: 'fresh',
        sendableLines: intent.sendableLines,
        armedAtIso,
        intent,
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
  backing?: {
    readonly runId: RunId;
    readonly armedAtIso: string;
    readonly artifactKind: RecoveryArtifactV1['kind'];
  },
): SlotMutation<boolean> {
  const pending = slots.pendingStart;
  if (pending === null) return unchanged(slots, false);
  if (
    backing !== undefined &&
    (pending.runId !== backing.runId || pending.armedAtIso !== backing.armedAtIso)
  ) {
    return unchanged(slots, false);
  }
  const revision = slots.revision + 1;
  return {
    slots: {
      ...slots,
      revision,
      activeRun: null,
      pendingStart: null,
      recoveryCapsule: {
        runId: pending.runId,
        // The archive may have committed before the app died. Hydration must
        // use that exact kind, or the stand-in written when no archive exists.
        artifactKind:
          backing?.artifactKind ??
          (pending.intent === undefined ? 'exact-execution' : 'legacy-fingerprint-only'),
        revision,
        ackedLines: 0,
        sendableLines: pending.sendableLines,
        interruption: {
          kind: 'unknown',
          message: START_HANDOFF_UNCERTAIN_MESSAGE,
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
