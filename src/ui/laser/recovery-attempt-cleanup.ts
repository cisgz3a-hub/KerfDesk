import type { RecoveryRepository } from '../state/recovery';

export type RecoveryAttemptCleanup = {
  readonly pendingStartCancelled: boolean;
  readonly claimReleased: boolean;
  readonly stagedRunDiscarded: boolean;
  readonly retryable: boolean;
};

type RecoveryAttemptCleanupArgs = {
  readonly repository: RecoveryRepository;
  readonly sourceRunId: string;
  readonly attemptId: string;
  readonly stagedRunId: string;
};

/** Releases ownership first, then independently removes the unaccepted staged
 * artifact. A failed artifact delete can never skip claim release. */
export async function cleanupRejectedRecoveryAttempt(
  args: RecoveryAttemptCleanupArgs,
): Promise<RecoveryAttemptCleanup> {
  const pendingStartCancelled = await cancelPendingStartWithRetry(args);
  const claimReleased = await releaseClaimWithRetry(args);
  let stagedRunDiscarded = false;
  try {
    const discarded = await args.repository.discardStagedRun(args.stagedRunId);
    stagedRunDiscarded = discarded.ok && discarded.value;
  } catch {
    stagedRunDiscarded = false;
  }
  return {
    pendingStartCancelled,
    claimReleased,
    stagedRunDiscarded,
    retryable: pendingStartCancelled && claimReleased,
  };
}

async function cancelPendingStartWithRetry(args: RecoveryAttemptCleanupArgs): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const cancelled = await args.repository.cancelPendingStart(args.stagedRunId);
      if (cancelled.ok && cancelled.value) return true;
    } catch {
      // Reconcile below, then make one bounded retry.
    }
    try {
      const refreshed = await args.repository.refresh();
      if (refreshed.ok && refreshed.value.pendingStart?.runId !== args.stagedRunId) return true;
    } catch {
      // Retry once; the final false result keeps wording fail-closed.
    }
  }
  return false;
}

async function releaseClaimWithRetry(
  args: Omit<RecoveryAttemptCleanupArgs, 'stagedRunId'>,
): Promise<boolean> {
  for (let releaseAttempt = 0; releaseAttempt < 2; releaseAttempt += 1) {
    try {
      const released = await args.repository.releaseRecoveryClaim(args.sourceRunId, args.attemptId);
      if (released.ok && released.value) return true;
    } catch {
      // Reconcile below, then make one bounded retry.
    }
    if (await claimIsNoLongerOwned(args)) return true;
  }
  return claimIsNoLongerOwned(args);
}

async function claimIsNoLongerOwned(
  args: Omit<RecoveryAttemptCleanupArgs, 'stagedRunId'>,
): Promise<boolean> {
  try {
    const refreshed = await args.repository.refresh();
    if (!refreshed.ok) return false;
    const capsule = refreshed.value.recoveryCapsule;
    return capsule?.runId !== args.sourceRunId || capsule.claim?.attemptId !== args.attemptId;
  } catch {
    return false;
  }
}
