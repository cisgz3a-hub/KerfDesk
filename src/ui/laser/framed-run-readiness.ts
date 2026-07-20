import { useCameraStore } from '../state/camera-store';
import type { FramedRunPermit } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { startExternalEnvironmentMatches } from './start-job-external-environment';

export const FRAME_JOB_FIRST_MESSAGE =
  'Frame this job first. A completed Frame authorizes the exact prepared job that Start will send.';

export function framedRunReadinessIssue(
  permit: FramedRunPermit | null,
  app: ReturnType<typeof useStore.getState> = useStore.getState(),
  laser: ReturnType<typeof useLaserStore.getState> = useLaserStore.getState(),
  camera: ReturnType<typeof useCameraStore.getState> = useCameraStore.getState(),
  options: { readonly ignoreControllerStatusState?: boolean } = {},
): string | null {
  if (permit === null) return FRAME_JOB_FIRST_MESSAGE;
  const transientProject = permit.candidate.authorizationContext === 'transient-camera';
  if (
    !transientProject &&
    currentReplayExecutionSignature(app) !== permit.candidate.executionSignature
  ) {
    return 'The artwork, output selection, placement, or registration changed after Frame. Frame the updated job again.';
  }
  const environmentProject = transientProject ? permit.candidate.project : app.project;
  if (
    !startExternalEnvironmentMatches(
      permit.candidate.externalEnvironment,
      environmentProject,
      camera,
    )
  ) {
    return 'The camera or rotary setup changed after Frame. Frame the current setup again.';
  }
  if (
    !controllerStartPreparationStillCurrent(permit.controller, laser, {
      ...(options.ignoreControllerStatusState === true ? { ignoreStatusState: true } : {}),
      // $30/$32 and build-info observations may be refreshed after Frame.
      // They are review evidence, not permit identity; current exact M7
      // incompatibility is rechecked immediately before wire dispatch.
      ignoreAdvisoryControllerEvidence: true,
    })
  ) {
    return 'The controller session, position, origin, or CNC Z reference changed after Frame. Frame the job again.';
  }
  return null;
}
