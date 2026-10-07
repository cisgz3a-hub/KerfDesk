// Repository reads and settlement helpers of the job checkpoint tracker
// (use-job-checkpoint.ts), kept apart so the tracker stays within its size.

import type { StreamerStatus } from '../../core/controllers/grbl';
import type { JobInterruption } from '../../core/recovery';
import { currentJobStopRequest } from '../state/job-stop-request';
import { hasOwnedControllerReset } from '../state/laser-reset-cleanup';
import { isUnarchivedRun } from '../state/laser-unarchived-run';
import { useLaserStore, type LaserState } from '../state/laser-store';
import type { RecoveryRepository, RunId } from '../state/recovery';
import {
  checkpointInterruption,
  currentRunPlannerBacklog,
  runStopMayHaveLostPosition,
} from './checkpoint-interruption';

export type TrackingFailureReporter = (error: unknown) => void;

/** A terminal the repository recorded, or one for a run the archive never held
 * (ADR-341 Amendment 7): there is nothing to retry, and Start already told the
 * operator this run keeps no archive. */
export function terminalRecordedOrUnarchived(
  result: Awaited<ReturnType<RecoveryRepository['interruptRun']>>,
  runId: RunId,
): boolean {
  return result.ok && (result.value || isUnarchivedRun(runId));
}

export function progressDeferredOrSettled(
  repository: RecoveryRepository,
  runId: RunId,
  ackedLines: number,
): boolean {
  const snapshot = repository.getSnapshot();
  if (snapshot.activeRun?.runId === runId) return false;
  if (snapshot.pendingStart?.runId === runId) return true;
  if (snapshot.lastCompletedReceipt?.runId === runId) return true;
  return (
    snapshot.recoveryCapsule?.runId === runId && snapshot.recoveryCapsule.ackedLines >= ackedLines
  );
}

export function activeInRepository(repository: RecoveryRepository, runId: RunId): boolean {
  return repository.getSnapshot().activeRun?.runId === runId;
}

export function onceTrackingFailureReporter(
  reportTrackingFailure: TrackingFailureReporter,
): TrackingFailureReporter {
  let hasReported = false;
  return (error) => {
    if (hasReported) return;
    hasReported = true;
    reportTrackingFailure(error);
  };
}

export function cachedAck(repository: RecoveryRepository, runId: RunId): number {
  const active = repository.getSnapshot().activeRun;
  return active?.runId === runId ? active.ackedLines : 0;
}

export function disappearedStreamInterruption(
  previousStatus: StreamerStatus,
  state: LaserState,
): JobInterruption {
  return (
    checkpointInterruption(
      state.connection.kind === 'connected' ? previousStatus : 'disconnected',
      state.safetyNotice,
      currentJobStopRequest(state),
      currentRunPlannerBacklog(state),
      runStopMayHaveLostPosition(state),
    ) ?? {
      kind: state.connection.kind === 'connected' ? 'unknown' : 'disconnect',
      message:
        state.connection.kind === 'connected'
          ? 'The job stream ended before clean physical completion.'
          : 'The controller connection ended before clean physical completion.',
    }
  );
}

export function observedStreamInterruption(
  status: StreamerStatus,
  state: LaserState,
): JobInterruption | null {
  if (
    status === 'errored' &&
    hasOwnedControllerReset(state.controllerOperation) &&
    (state.safetyNotice === null || state.safetyNotice.kind === 'cnc-transition-unconfirmed')
  ) {
    // Reset freezes host refill before the accepted Stop or closed port can
    // publish its terminal event. Real fault notices keep their own cause.
    return null;
  }
  return checkpointInterruption(
    status,
    state.safetyNotice,
    currentJobStopRequest(state),
    currentRunPlannerBacklog(state),
    runStopMayHaveLostPosition(state),
    state.streamer === null
      ? undefined
      : Math.min(state.streamer.total, state.streamer.completed + state.streamer.inFlight.length),
  );
}

export function clearInactiveRunOwnership(runId: RunId): void {
  const state = useLaserStore.getState();
  if (state.streamer === null && state.activeRunId === runId) {
    useLaserStore.setState({ activeRunId: null });
  }
}
