// A laser recovery attempt whose Start failed (ADR-341). No program attempted:
// release the claim so the saved job can be retried. A program prefix may have
// reached the controller: retain that attempt as interrupted, with or without
// an archive (Amendment 8).

import { jobAwareAlert } from '../state/job-aware-dialogs';
import {
  isJobStartBeforeProgramError,
  isJobStartTransmissionError,
} from '../state/laser-start-transmission-error';
import { useLaserStore } from '../state/laser-store';
import type { RecoveryCapsule, RecoveryRepository } from '../state/recovery';
import { acceptLaserRecoveryRun, type UntrackedLaserRecovery } from './laser-recovery-untracked';
import { cleanupRejectedRecoveryAttempt } from './recovery-attempt-cleanup';

export async function resolveFailedAttempt(args: {
  readonly repository: RecoveryRepository;
  readonly sourceCapsule: RecoveryCapsule;
  readonly attemptId: string;
  readonly recoveryRunId: string;
  readonly error: unknown;
  readonly untracked: UntrackedLaserRecovery | undefined;
}): Promise<void> {
  const state = useLaserStore.getState();
  const message = args.error instanceof Error ? args.error.message : String(args.error);
  const attemptedAckedLines = attemptedRunAcknowledgements(args.error, args.recoveryRunId);
  if (
    (isJobStartBeforeProgramError(args.error) && args.error.runId === args.recoveryRunId) ||
    (attemptedAckedLines === null &&
      (state.streamer === null || state.activeRunId !== args.recoveryRunId))
  ) {
    const cleanup = await cleanupRejectedRecoveryAttempt({
      repository: args.repository,
      sourceRunId: args.sourceCapsule.runId,
      attemptId: args.attemptId,
      stagedRunId: args.recoveryRunId,
    });
    const cleanupMessage = cleanup.retryable
      ? message
      : `${message}\n\nThe durable Start handoff or recovery claim could not be cleared. Reload after recovery storage is available.`;
    jobAwareAlert(`Could not start laser recovery:\n\n${cleanupMessage}`);
    return;
  }
  const activated = await acceptLaserRecoveryRun(
    args.repository,
    {
      sourceRunId: args.sourceCapsule.runId,
      sourceRevision: args.sourceCapsule.revision,
      attemptId: args.attemptId,
      recoveryRunId: args.recoveryRunId,
    },
    args.untracked,
  );
  if (activated) {
    await args.repository.interruptRun(
      args.recoveryRunId,
      attemptedAckedLines ?? state.streamer?.completed ?? 0,
      {
        kind: 'write-failed',
        message,
      },
    );
  } else {
    await args.repository.noteUntrackedRunAccepted(args.recoveryRunId);
  }
  jobAwareAlert(
    `Laser recovery transmission became uncertain:\n\n${message}\n\nInspect and requalify the machine before any further motion.`,
  );
}

function attemptedRunAcknowledgements(error: unknown, runId: string): number | null {
  return isJobStartTransmissionError(error) && error.runId === runId ? error.ackedLines : null;
}
