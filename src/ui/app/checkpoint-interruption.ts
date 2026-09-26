import { describeAlarm, type StreamerStatus } from '../../core/controllers/grbl';
import type { JobInterruption } from '../../core/recovery';
import {
  currentStreamResetMayLosePosition,
  jobStopRequestMessage,
  type JobStopRequest,
  type StreamReset,
} from '../state/job-stop-request';
import type { LaserSafetyNotice } from '../state/laser-safety-notice';
import {
  controllerPlannerSizeBlocks,
  type PlannerSizeSource,
  type StreamPlannerSnapshot,
} from '../state/laser-rx-capacity-evidence';

/** The recorded cause of a terminal stream: a safety notice names its fault;
 * without one, a stop KerfDesk was asked for (Abort, the app closing) is a
 * cancellation, and only a stop nobody asked for is unexplained. A cause that
 * discarded the controller's planner also records its backlog, so recovery
 * restarts before the moves it threw away (controller audit recovery-6). A
 * stop that may have killed the steppers mid-motion is marked position-lost
 * (ADR-215 Amendment 1). */
export function checkpointInterruption(
  status: StreamerStatus,
  notice: LaserSafetyNotice | null,
  stopRequest: JobStopRequest | null = null,
  plannerBacklog?: JobInterruption['plannerBacklog'],
  positionLost = false,
): JobInterruption | null {
  const cause = interruptionCause(status, notice, stopRequest);
  const interruption =
    cause !== null && positionLost ? { ...cause, positionLost: true as const } : cause;
  if (interruption === null || plannerBacklog === undefined) return interruption;
  // The stop sent while the app closed may never have arrived.
  const stopMayNotHaveArrived = stopRequest?.reason === 'app-closing';
  return PLANNER_DISCARDING_KINDS.includes(interruption.kind) && !stopMayNotHaveArrived
    ? { ...interruption, plannerBacklog }
    : interruption;
}

// Abort and an ALARM stop with a soft reset or alarm; an auto-abort follows a
// rejected line; a reboot loses everything. A lost link, a failed write or a
// stall leaves the controller running what it had.
const PLANNER_DISCARDING_KINDS: ReadonlyArray<JobInterruption['kind']> = [
  'cancelled',
  'controller-error',
  'controller-reboot',
];

/** Whether the run's stop may have killed the steppers mid-motion: a reset
 * KerfDesk sent against a moving machine, or an alarm GRBL or grblHAL
 * documents as losing position (a hard limit, ALARM:3). Code 10 is a homing
 * failure on GRBL and an E-stop on grblHAL; both lose position, so either
 * table's verdict counts. Start refuses an alarmed controller, so an alarm
 * code seen during a run was raised by it (ADR-215 Amendment 1). */
export function runStopMayHaveLostPosition(state: {
  readonly alarmCode: number | null;
  readonly streamReset?: StreamReset | null;
  readonly streamerEpoch: number;
}): boolean {
  if (currentStreamResetMayLosePosition(state)) return true;
  if (state.alarmCode === null) return false;
  return (
    describeAlarm(state.alarmCode, 'grbl')?.positionLost === true ||
    describeAlarm(state.alarmCode, 'grblhal')?.positionLost === true
  );
}

function interruptionCause(
  status: StreamerStatus,
  notice: LaserSafetyNotice | null,
  stopRequest: JobStopRequest | null,
): JobInterruption | null {
  if (!['cancelled', 'disconnected', 'errored'].includes(status)) return null;
  if (notice === null && stopRequest !== null) {
    return { kind: 'cancelled', message: jobStopRequestMessage(stopRequest.reason) };
  }
  if (notice === null) return fallbackInterruption(status);
  return {
    kind: noticeKind(status, notice),
    message: notice.message,
    ...(notice.kind === 'controller-error' && notice.rejectedLine !== undefined
      ? { rejectedLine: notice.rejectedLine }
      : {}),
  };
}

type PlannerBacklogSource = PlannerSizeSource & {
  readonly streamerEpoch: number;
  readonly streamPlannerSnapshot?: StreamPlannerSnapshot | null;
  readonly streamer?: { readonly completed: number } | null;
};

/** The backlog the current run's latest status report showed. A report that
 * showed an empty planner is still a frontier: every line acknowledged by then
 * had run. Without such a report, the stop may have discarded the controller's
 * whole planner of acknowledged moves (controller audit OR-3). */
export function currentRunPlannerBacklog(
  state: PlannerBacklogSource,
): JobInterruption['plannerBacklog'] {
  const snapshot = state.streamPlannerSnapshot ?? null;
  if (snapshot !== null && snapshot.streamerEpoch === state.streamerEpoch) {
    return { ackedAtStatus: snapshot.ackedLines, queuedBlocks: snapshot.queuedBlocks };
  }
  const plannerBlocks = controllerPlannerSizeBlocks(state);
  const acked = state.streamer?.completed;
  if (plannerBlocks === undefined || acked === undefined) return undefined;
  return { ackedAtStatus: acked, queuedBlocks: plannerBlocks, bound: 'planner-size' };
}

function noticeKind(status: StreamerStatus, notice: LaserSafetyNotice): JobInterruption['kind'] {
  // A fire-time link drop is a disconnect just like a job-time one: GRBL may
  // still be executing its buffer, so recovery treats both as 'disconnect'.
  if (notice.kind === 'disconnect-during-job' || notice.kind === 'disconnect-during-fire') {
    return 'disconnect';
  }
  // A no-realtime-reset controller can raise this while the port remains
  // connected and the operator aborts. Preserve Abort as cancellation; only
  // an actually disconnected streamer records a disconnect interruption.
  if (notice.kind === 'disconnect-stop-unconfirmed') {
    return status === 'cancelled' ? 'cancelled' : 'disconnect';
  }
  if (notice.kind === 'frame-limit' || notice.kind === 'home-unfinished') return 'unknown';
  // The lift's own reset kept position (ADR-411); the stop that followed
  // discarded the planner the way a rejected line's auto-stop does.
  if (notice.kind === 'cnc-pause-lift-failed') return 'controller-error';
  return notice.kind;
}

function fallbackInterruption(status: StreamerStatus): JobInterruption {
  if (status === 'disconnected') {
    return { kind: 'disconnect', message: 'The serial connection closed during the job.' };
  }
  if (status === 'cancelled') {
    return { kind: 'cancelled', message: 'The job stopped before physical completion.' };
  }
  return { kind: 'unknown', message: 'The job stream ended unexpectedly.' };
}
