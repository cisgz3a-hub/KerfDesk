import type { FramedRunEvidence } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';

export const FRAME_JOB_FIRST_MESSAGE =
  'Frame this job first. A completed Frame authorizes the exact prepared job that Start will send.';

export const JOB_CHANGED_AFTER_FRAME_REASON =
  'The artwork, output selection, placement, or registration changed after Frame.';
export const CONTROLLER_CHANGED_AFTER_FRAME_REASON =
  'The controller session, position, origin, or CNC Z reference changed after Frame.';

type ReadinessOptions = { readonly ignoreControllerStatusState?: boolean };

/** Null when the completed Frame evidence — a permit, or a trace awaiting its
 * exact program — still describes the current job and controller. */
export function framedRunReadinessIssue(
  permit: FramedRunEvidence | null,
  app: ReturnType<typeof useStore.getState> = useStore.getState(),
  laser: ReturnType<typeof useLaserStore.getState> = useLaserStore.getState(),
  options: ReadinessOptions = {},
): string | null {
  if (permit === null) return FRAME_JOB_FIRST_MESSAGE;
  const reason = framedRunDriftReason(permit, app, laser, options);
  if (reason === JOB_CHANGED_AFTER_FRAME_REASON) return `${reason} Frame the updated job again.`;
  return reason === null ? null : `${reason} Frame the job again.`;
}

/** What drifted since the Frame: the job, or the controller; null when nothing did. */
export function framedRunDriftReason(
  permit: FramedRunEvidence,
  app: ReturnType<typeof useStore.getState> = useStore.getState(),
  laser: ReturnType<typeof useLaserStore.getState> = useLaserStore.getState(),
  options: ReadinessOptions = {},
): string | null {
  const transientProject = permit.candidate.authorizationContext !== undefined;
  if (
    !transientProject &&
    currentReplayExecutionSignature(app) !== permit.candidate.executionSignature
  ) {
    return JOB_CHANGED_AFTER_FRAME_REASON;
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
    return CONTROLLER_CHANGED_AFTER_FRAME_REASON;
  }
  return null;
}
