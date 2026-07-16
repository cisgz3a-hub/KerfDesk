import { controllerQualificationStartBlockMessage } from '../state/laser-controller-qualification';
import { useLaserStore } from '../state/laser-store';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';

export const RECOVERY_SETUP_CHANGED_MESSAGE =
  'Controller or machine setup changed while recovery was being prepared. No recovery G-code was sent. Review the current setup and start recovery again.';

/** Synchronous final recovery gate. startJob invokes this after its last
 * asynchronous controller check and immediately before streamer creation. */
export function finalRecoveryStartAssertion(
  preparedAgainst: ReturnType<typeof useLaserStore.getState>,
): () => void {
  return () => {
    const current = useLaserStore.getState();
    const qualificationIssue = controllerQualificationStartBlockMessage(
      current.controllerQualification,
      current.controllerSessionEpoch,
    );
    if (
      qualificationIssue === null &&
      controllerStartPreparationStillCurrent(preparedAgainst, current)
    ) {
      return;
    }
    throw new Error(qualificationIssue ?? RECOVERY_SETUP_CHANGED_MESSAGE);
  };
}
