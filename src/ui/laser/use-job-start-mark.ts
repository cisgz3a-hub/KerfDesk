import { create } from 'zustand';
import { currentCompletedFrame, framedRunReadinessIssue } from './framed-run-readiness';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { prepareTransientFrameController } from './use-frame-action';
import { prepareCurrentStartJob } from './start-job-source';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { useCameraStore } from '../state/camera-store';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { framedRunControllerSnapshot } from '../state/framed-run';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { jobStartMarkBlockMessage } from '../state/laser-job-start-mark-actions';
import { useToastStore } from '../state/toast-store';
import { createJobStartMarkPreparationOperation } from '../state/job-start-mark';
import type { LaserState } from '../state/laser-store';
import type { FramedRunPermit, PreparedStartProgram } from '../state/framed-run';
import type { LaserControllerOperation } from '../state/laser-controller-operation';

export const useJobStartMarkPreparation = create<{ readonly pending: boolean }>(() => ({
  pending: false,
}));

/** One click prepares today's exact output. It never starts a job, consumes a
 * Start permit or promotes a Frame. Current Position uses an existing Frame's
 * fixed origin, captured before the temporary beam-off move. */
export async function runJobStartMarkNow(): Promise<boolean> {
  if (useJobStartMarkPreparation.getState().pending) return false;
  useJobStartMarkPreparation.setState({ pending: true });
  try {
    await prepareAndMark();
    useToastStore
      .getState()
      .pushToast(
        'Job start marked for one second. The head returned to its original position.',
        'info',
      );
    return true;
  } catch (error) {
    useToastStore
      .getState()
      .pushToast(error instanceof Error ? error.message : String(error), 'error');
    return false;
  } finally {
    useJobStartMarkPreparation.setState({ pending: false });
  }
}

async function prepareAndMark(): Promise<void> {
  ensureFramedRunInvalidationSubscriptions();
  const blocked = jobStartMarkBlockMessage(useLaserStore.getState());
  if (blocked !== null) throw new Error(blocked);
  // Reuse the existing owned G54/report-units/fresh-position preparation.
  // A real coordinate normalization can expire old spatial evidence normally.
  const readiness = await prepareTransientFrameController(useStore.getState().project);
  if (readiness === null)
    throw new Error('The controller could not prepare the current job start.');
  const app = useStore.getState();
  const laser = useLaserStore.getState();
  const blockedAfterReadiness = jobStartMarkBlockMessage(laser);
  if (blockedAfterReadiness !== null) throw new Error(blockedAfterReadiness);
  const frame = usableMarkFrame(app, laser);
  const preparationOperation = createJobStartMarkPreparationOperation();
  useLaserStore.setState({ controllerOperation: preparationOperation });
  try {
    const prepared = await prepareCurrentStartJob(
      app,
      laser,
      useCameraStore.getState(),
      frame?.candidate.preparedStart.jobOrigin,
      false,
    );
    if (!prepared.ok)
      throw new Error(prepared.messages[0] ?? 'The current job could not be compiled.');
    const current = useLaserStore.getState();
    if (!preparedMarkStillCurrent(laser, current, prepared, preparationOperation)) {
      throw new Error('The job or controller changed while preparing the start mark.');
    }
    const initialPosition = reportedWorkPositionMm(
      current,
      current.controllerSettings?.reportInches === true,
    );
    if (initialPosition === null) throw new Error('The start mark needs a known work position.');
    await current.markJobStart({
      prepared,
      controller: framedRunControllerSnapshot(current),
      connectionAttempt: current.connectionAttempt,
      initialPosition,
      frame,
      preparationOperation,
    });
  } finally {
    if (useLaserStore.getState().controllerOperation === preparationOperation) {
      useLaserStore.setState({ controllerOperation: null });
    }
  }
}

function usableMarkFrame(
  app: ReturnType<typeof useStore.getState>,
  laser: LaserState,
): FramedRunPermit | null {
  const existing = currentCompletedFrame(laser);
  return existing?.candidate.authorizationContext === undefined &&
    framedRunReadinessIssue(existing, app, laser) === null
    ? existing
    : null;
}

function preparedMarkStillCurrent(
  before: LaserState,
  current: LaserState,
  prepared: PreparedStartProgram,
  operation: LaserControllerOperation,
): boolean {
  return (
    current.controllerOperation === operation &&
    currentReplayExecutionSignature() === prepared.canvasPlan.retentionKey &&
    controllerStartPreparationStillCurrent(before, current, {
      ignoreAdvisoryControllerEvidence: true,
    })
  );
}
