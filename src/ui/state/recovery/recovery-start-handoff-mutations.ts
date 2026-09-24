import type { JobCheckpoint } from '../../../core/recovery';
import type { ExecutionArtifactV1, RecoveryArtifactV1, RunId } from './execution-artifact';
import { appendBoundedExecutionHistory } from './execution-history';
import type { PendingStartRecord, PersistedRecoverySlots } from './recovery-model';
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

/** The live owner of an intent-armed Start renews its lease. Bound to the run
 * and its arm time, so a handoff reconciled, cancelled or purged meanwhile —
 * or a newer Start armed after it — is never revived. */
export function renewPendingStartLeaseMutation(
  slots: PersistedRecoverySlots,
  owned: { readonly runId: RunId; readonly armedAtIso: string },
  renewedAtIso: string,
): SlotMutation<boolean> {
  const pending = slots.pendingStart;
  if (pending?.runId !== owned.runId || pending.armedAtIso !== owned.armedAtIso) {
    return unchanged(slots, false);
  }
  return {
    slots: {
      ...slots,
      revision: slots.revision + 1,
      pendingStart: { ...pending, leaseRenewedAtIso: renewedAtIso },
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
    /** The lease the reconciler watched lapse; a renewal since then means the
     * owner is alive after all. */
    readonly leaseRenewedAtIso?: string;
    readonly artifactKind: RecoveryArtifactV1['kind'];
    /** The archive's own size estimate, when an exact archive backs the run. */
    readonly estimatedArtifactBytes?: number;
  },
): SlotMutation<boolean> {
  const pending = slots.pendingStart;
  if (pending === null) return unchanged(slots, false);
  if (backing !== undefined && !sameStartLease(pending, backing)) return unchanged(slots, false);
  const revision = slots.revision + 1;
  // The archive may have committed before the app died. Hydration must use
  // that exact kind, or the stand-in written when no archive exists.
  const artifactKind =
    backing?.artifactKind ??
    (pending.intent === undefined ? 'exact-execution' : 'legacy-fingerprint-only');
  const interruption = { kind: 'unknown' as const, message: START_HANDOFF_UNCERTAIN_MESSAGE };
  return {
    slots: {
      ...slots,
      revision,
      activeRun: null,
      pendingStart: null,
      recoveryCapsule: {
        runId: pending.runId,
        artifactKind,
        revision,
        ackedLines: 0,
        sendableLines: pending.sendableLines,
        interruption,
        updatedAtIso,
      },
      lastCompletedReceipt: null,
      // An exact archive is readable (for lineage replay and painted passes)
      // only through the run history, like every other interrupted run.
      ...(artifactKind === 'exact-execution'
        ? {
            executionHistory: appendBoundedExecutionHistory(slots, {
              runId: pending.runId,
              terminalKind: 'interrupted',
              startedAtIso: pending.armedAtIso,
              terminalAtIso: updatedAtIso,
              ackedLines: 0,
              sendableLines: pending.sendableLines,
              estimatedArtifactBytes: backing?.estimatedArtifactBytes ?? 0,
              interruption,
            }),
          }
        : {}),
    },
    value: true,
  };
}

/** One run, armed once, renewed last at the same moment: the lease a
 * reconciler observed is still the one in the record. */
export function sameStartLease(
  left: Pick<PendingStartRecord, 'runId' | 'armedAtIso' | 'leaseRenewedAtIso'>,
  right: Pick<PendingStartRecord, 'runId' | 'armedAtIso' | 'leaseRenewedAtIso'>,
): boolean {
  return (
    left.runId === right.runId &&
    left.armedAtIso === right.armedAtIso &&
    left.leaseRenewedAtIso === right.leaseRenewedAtIso
  );
}

function unchanged<T>(slots: PersistedRecoverySlots, value: T): SlotMutation<T> {
  return { slots, value };
}
