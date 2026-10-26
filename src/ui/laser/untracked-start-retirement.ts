// A Start that streams without a run id — a manual Start from line, an
// external G-code file (ADR-630), the camera calibration target — keeps no
// recovery record of its own. An accepted stream still changes physical
// machine state, so the previous job's recovery card, its Run again receipt
// and its second-pass offer no longer describe the last thing the machine ran
// (ADR-341 Amendment 4 decision 1). The manual restart retired them; the
// external run and the camera target did not (rolling audit 2026-10-21,
// 05-P3-1). Each now retires them once the controller may have received its
// program: after Start returns, or after a program write was attempted.

import { withdrawUnarchivedOffer } from '../state/laser-unarchived-run';
import { isJobStartTransmissionError } from '../state/laser-start-transmission-error';
import { recoveryRepository, type RecoveryRepository } from '../state/recovery';

/** Retires the older recovery card, Run again receipt and second-pass offer. */
export async function retireRecoveryAfterUntrackedStart(
  repository: RecoveryRepository = recoveryRepository,
): Promise<void> {
  withdrawUnarchivedOffer();
  await repository.noteUntrackedRunAccepted();
}

/** Runs an untracked Start, then retires the older offers. A refusal before
 * any program write leaves them; an attempted write retires them before the
 * error is rethrown. */
export async function startUntrackedRun(
  start: () => Promise<void>,
  repository: RecoveryRepository = recoveryRepository,
): Promise<void> {
  try {
    await start();
  } catch (error) {
    if (isJobStartTransmissionError(error)) await retireRecoveryAfterUntrackedStart(repository);
    throw error;
  }
  await retireRecoveryAfterUntrackedStart(repository);
}
