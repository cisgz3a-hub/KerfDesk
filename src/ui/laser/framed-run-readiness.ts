import type { FramedRunEvidence } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';

export const FRAME_JOB_FIRST_MESSAGE =
  'Frame this job first. A completed Frame authorizes the exact prepared job that Start will send.';

/** Null when the completed Frame evidence — a permit, or a trace awaiting its
 * exact program — still describes the current job and controller. */
export function framedRunReadinessIssue(
  permit: FramedRunEvidence | null,
  app: ReturnType<typeof useStore.getState> = useStore.getState(),
  laser: ReturnType<typeof useLaserStore.getState> = useLaserStore.getState(),
  options: { readonly ignoreControllerStatusState?: boolean } = {},
): string | null {
  if (permit === null) return FRAME_JOB_FIRST_MESSAGE;
  const transientProject = permit.candidate.authorizationContext !== undefined;
  if (
    !transientProject &&
    currentReplayExecutionSignature(app) !== permit.candidate.executionSignature
  ) {
    return 'The artwork, output selection, placement, or registration changed after Frame. Frame the updated job again.';
  }
  if (
    !controllerStartPreparationStillCurrent(permit.controller, laser, {
      ...(options.ignoreControllerStatusState === true ? { ignoreStatusState: true } : {}),
      // $30/$32 and build-info observations may be refreshed after Frame.
      // They are advisory review evidence, not permit identity; wire dispatch
      // later checks only that review evidence still binds the exact M7 shape.
      ignoreAdvisoryControllerEvidence: true,
    })
  ) {
    return 'The controller session, position, origin, or CNC Z reference changed after Frame. Frame the job again.';
  }
  return null;
}
