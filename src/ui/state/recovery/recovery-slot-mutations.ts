import type { JobInterruption } from '../../../core/recovery';
import type { ExecutionArtifactV1, RunId } from './execution-artifact';
import type { PersistedRecoverySlots } from './recovery-model';

export type SlotMutation<T> = {
  readonly slots: PersistedRecoverySlots;
  readonly value: T;
};

export function activateFreshRunMutation(
  slots: PersistedRecoverySlots,
  artifact: ExecutionArtifactV1,
  artifactGeneration: number,
  acceptedAtIso: string,
): SlotMutation<boolean> {
  if (artifactGeneration !== slots.generation) return unchanged(slots, false);
  if (slots.pendingStart !== null && slots.pendingStart.runId !== artifact.runId) {
    return unchanged(slots, false);
  }
  // A very short stream can settle before the post-write Start continuation
  // activates its staged artifact. Terminal tracking is authoritative in that
  // race: a late activation must not turn a completed/interrupted run back into
  // a live run.
  if (
    slots.activeRun?.runId === artifact.runId ||
    slots.recoveryCapsule?.runId === artifact.runId ||
    slots.lastCompletedReceipt?.runId === artifact.runId
  ) {
    return unchanged(slots, true);
  }
  return {
    slots: {
      ...slots,
      revision: slots.revision + 1,
      activeRun: {
        runId: artifact.runId,
        ackedLines: 0,
        sendableLines: artifact.sendableLines,
        startedAtIso: acceptedAtIso,
        updatedAtIso: acceptedAtIso,
      },
      recoveryCapsule: null,
      lastCompletedReceipt: null,
      pendingStart: null,
    },
    value: true,
  };
}

export function updateProgressMutation(
  slots: PersistedRecoverySlots,
  runId: RunId,
  ackedLines: number,
  updatedAtIso: string,
): SlotMutation<boolean> {
  const active = slots.activeRun;
  if (active?.runId !== runId) return unchanged(slots, false);
  const nextAcked = clampProgress(ackedLines, active.sendableLines);
  if (nextAcked <= active.ackedLines) return unchanged(slots, true);
  return {
    slots: {
      ...slots,
      revision: slots.revision + 1,
      activeRun: { ...active, ackedLines: nextAcked, updatedAtIso },
    },
    value: true,
  };
}

export function interruptRunMutation(
  slots: PersistedRecoverySlots,
  runId: RunId,
  ackedLines: number,
  interruption: JobInterruption,
  updatedAtIso: string,
): SlotMutation<boolean> {
  const active = slots.activeRun;
  if (slots.recoveryCapsule?.runId === runId) return unchanged(slots, true);
  if (active?.runId !== runId) return unchanged(slots, false);
  const revision = slots.revision + 1;
  return {
    slots: {
      ...slots,
      revision,
      activeRun: null,
      recoveryCapsule: {
        runId,
        artifactKind: 'exact-execution',
        revision,
        ackedLines: Math.max(active.ackedLines, clampProgress(ackedLines, active.sendableLines)),
        sendableLines: active.sendableLines,
        interruption,
        updatedAtIso,
      },
      lastCompletedReceipt: null,
    },
    value: true,
  };
}

export function completeRunMutation(
  slots: PersistedRecoverySlots,
  runId: RunId,
  completedAtIso: string,
): SlotMutation<boolean> {
  if (slots.lastCompletedReceipt?.runId === runId) return unchanged(slots, true);
  if (slots.activeRun?.runId !== runId) return unchanged(slots, false);
  return {
    slots: {
      ...slots,
      revision: slots.revision + 1,
      activeRun: null,
      lastCompletedReceipt: { runId, completedAtIso },
    },
    value: true,
  };
}

export function noteUntrackedRunAcceptedMutation(
  slots: PersistedRecoverySlots,
): SlotMutation<boolean> {
  if (
    slots.activeRun === null &&
    slots.recoveryCapsule === null &&
    slots.lastCompletedReceipt === null &&
    slots.pendingStart === null
  ) {
    return unchanged(slots, true);
  }
  return {
    slots: {
      ...slots,
      revision: slots.revision + 1,
      activeRun: null,
      recoveryCapsule: null,
      lastCompletedReceipt: null,
      pendingStart: null,
    },
    value: true,
  };
}

export function discardRecoveryMutation(
  slots: PersistedRecoverySlots,
  expected?: { readonly runId: RunId; readonly revision: number },
): SlotMutation<boolean> {
  const capsule = slots.recoveryCapsule;
  if (capsule === null) return unchanged(slots, true);
  if (
    expected !== undefined &&
    (capsule.runId !== expected.runId || capsule.revision !== expected.revision)
  ) {
    return unchanged(slots, false);
  }
  return {
    slots: { ...slots, revision: slots.revision + 1, recoveryCapsule: null },
    value: true,
  };
}

export function discardCompletedReceiptMutation(
  slots: PersistedRecoverySlots,
  expectedRunId: RunId,
): SlotMutation<boolean> {
  const receipt = slots.lastCompletedReceipt;
  if (receipt === null) return unchanged(slots, true);
  if (receipt.runId !== expectedRunId) return unchanged(slots, false);
  return {
    slots: { ...slots, revision: slots.revision + 1, lastCompletedReceipt: null },
    value: true,
  };
}

export function claimRecoveryMutation(
  slots: PersistedRecoverySlots,
  args: {
    readonly runId: RunId;
    readonly revision: number;
    readonly attemptId: string;
    readonly claimedAtIso: string;
  },
): SlotMutation<boolean> {
  const capsule = slots.recoveryCapsule;
  if (
    capsule === null ||
    capsule.runId !== args.runId ||
    capsule.revision !== args.revision ||
    capsule.claim !== undefined
  ) {
    return unchanged(slots, false);
  }
  const revision = slots.revision + 1;
  return {
    slots: {
      ...slots,
      revision,
      recoveryCapsule: {
        ...capsule,
        revision,
        claim: { attemptId: args.attemptId, claimedAtIso: args.claimedAtIso },
      },
    },
    value: true,
  };
}

export function releaseRecoveryClaimMutation(
  slots: PersistedRecoverySlots,
  runId: RunId,
  attemptId: string,
  updatedAtIso: string,
): SlotMutation<boolean> {
  const capsule = slots.recoveryCapsule;
  if (capsule?.runId !== runId || capsule.claim?.attemptId !== attemptId) {
    return unchanged(slots, false);
  }
  const revision = slots.revision + 1;
  const { claim: _claim, ...unclaimed } = capsule;
  return {
    slots: {
      ...slots,
      revision,
      recoveryCapsule: { ...unclaimed, revision, updatedAtIso },
    },
    value: true,
  };
}

export function activateClaimedRecoveryMutation(
  slots: PersistedRecoverySlots,
  args: {
    readonly sourceRunId: RunId;
    readonly sourceRevision: number;
    readonly attemptId: string;
    readonly artifact: ExecutionArtifactV1;
    readonly artifactGeneration: number;
    readonly acceptedAtIso: string;
  },
): SlotMutation<boolean> {
  if (args.artifactGeneration !== slots.generation) return unchanged(slots, false);
  if (slots.pendingStart !== null && slots.pendingStart.runId !== args.artifact.runId) {
    return unchanged(slots, false);
  }
  // Recovery transmission can settle before the post-write activation
  // continuation runs, or another window can finish the same claimed
  // activation first. Never resurrect that already-owned target run.
  if (slotsReferenceRun(slots, args.artifact.runId)) {
    return unchanged(slots, true);
  }
  const capsule = slots.recoveryCapsule;
  if (
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
      activeRun: {
        runId: args.artifact.runId,
        ackedLines: 0,
        sendableLines: args.artifact.sendableLines,
        startedAtIso: args.acceptedAtIso,
        updatedAtIso: args.acceptedAtIso,
      },
      recoveryCapsule: null,
      lastCompletedReceipt: null,
      pendingStart: null,
    },
    value: true,
  };
}

export function promoteStaleActiveRunMutation(
  slots: PersistedRecoverySlots,
  updatedAtIso: string,
): SlotMutation<boolean> {
  const active = slots.activeRun;
  if (active === null) return unchanged(slots, false);
  const revision = slots.revision + 1;
  return {
    slots: {
      ...slots,
      revision,
      activeRun: null,
      recoveryCapsule: {
        runId: active.runId,
        artifactKind: 'exact-execution',
        revision,
        ackedLines: active.ackedLines,
        sendableLines: active.sendableLines,
        interruption: {
          kind: 'unknown',
          message: 'The application restarted while this job was active.',
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

function slotsReferenceRun(slots: PersistedRecoverySlots, runId: RunId): boolean {
  return (
    slots.activeRun?.runId === runId ||
    slots.recoveryCapsule?.runId === runId ||
    slots.lastCompletedReceipt?.runId === runId
  );
}

function clampProgress(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.floor(value), 0), maximum);
}
