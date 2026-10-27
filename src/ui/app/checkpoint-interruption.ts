import type { StreamerStatus } from '../../core/controllers/grbl';
import { presentAlarm } from '../../core/controllers/grbl/response-presentation';
import type { ControllerKind } from '../../core/devices';
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
 * (ADR-215 Amendment 1). A lost link records the lines sent by then, and keeps
 * its backlog aside until the reconnect shows whether the controller
 * restarted (ADR-398 Amendment 3). `streamReset`: KerfDesk sent a reset
 * against this stream, which discarded the planner whatever the cause. */
export function checkpointInterruption(
  status: StreamerStatus,
  notice: LaserSafetyNotice | null,
  stopRequest: JobStopRequest | null = null,
  plannerBacklog?: JobInterruption['plannerBacklog'],
  positionLost = false,
  sentLines?: number,
  streamReset = false,
): JobInterruption | null {
  const cause = interruptionCause(status, notice, stopRequest);
  if (cause === null) return null;
  const interruption = withSentLines(
    positionLost ? { ...cause, positionLost: true as const } : cause,
    sentLines,
  );
  if (plannerBacklog === undefined) return interruption;
  if (interruption.kind === 'disconnect') {
    return { ...interruption, plannerBacklogIfRestarted: plannerBacklog };
  }
  return PLANNER_DISCARDING_KINDS.includes(interruption.kind) || streamReset
    ? { ...interruption, plannerBacklog }
    : interruption;
}

/** A controller that keeps running after a lost link runs what it had
 * received, so the head stops at the end of the last line sent. The record
 * keeps how many that was, acknowledged lines plus those still in flight, so
 * recovery can continue from where the head stands (ADR-341 Amendment 6).
 * Other stops either discarded the planner or failed a write whose lines may
 * never have left. */
function withSentLines(
  interruption: JobInterruption,
  sentLines: number | undefined,
): JobInterruption {
  return interruption.kind === 'disconnect' && sentLines !== undefined
    ? { ...interruption, sentLines }
    : interruption;
}

// Abort and an ALARM stop with a soft reset or alarm; an auto-abort follows a
// rejected line; a reboot loses everything. The app closing sends Abort too:
// the desktop close awaits it, and where it may not have arrived (a web page
// unloading, a forced Windows restart) a step back re-burns what a controller
// that kept running had already burned, which ADR-398 Decision 2 prefers to
// skipping. A failed write or a stall leaves the controller running what it
// had, unless KerfDesk reset it to contain the fault (`streamReset`, ADR-398
// Amendment 5). A lost link may do either: an Arduino-class board resets when
// its port reopens, so the reconnect decides (ADR-398 Amendment 3).
const PLANNER_DISCARDING_KINDS: ReadonlyArray<JobInterruption['kind']> = [
  'cancelled',
  'controller-error',
  'controller-reboot',
];

/** Whether the run's stop may have killed the steppers mid-motion: a reset
 * KerfDesk sent against a moving machine, or an alarm the connected
 * controller's own table documents as losing position (a hard limit,
 * ALARM:3). The tables number alarms differently: 13 is a hard stop on
 * FluidNC but probe protection on grblHAL, so the code is read against the
 * firmware that raised it (ADR-644): the connected driver's, and also the
 * banner's when it names a different firmware, either verdict counting.
 * Start refuses an alarmed controller, so an alarm code seen during a run was
 * raised by it (ADR-215 Amendment 1). */
export function runStopMayHaveLostPosition(state: {
  readonly alarmCode: number | null;
  readonly streamReset?: StreamReset | null;
  readonly streamerEpoch: number;
  readonly activeControllerKind: ControllerKind;
  readonly detectedControllerKind?: ControllerKind | null;
}): boolean {
  if (currentStreamResetMayLosePosition(state)) return true;
  const code = state.alarmCode;
  if (code === null) return false;
  const kinds = [state.activeControllerKind, state.detectedControllerKind ?? null];
  return kinds.some((kind) => kind !== null && presentAlarm(kind, code)?.positionLost === true);
}

function interruptionCause(
  status: StreamerStatus,
  notice: LaserSafetyNotice | null,
  stopRequest: JobStopRequest | null,
): JobInterruption | null {
  if (!['cancelled', 'disconnected', 'errored'].includes(status)) return null;
  // A retained CNC transition warning is not a terminal cause. Record the
  // later accepted Abort, actual disconnect or fault instead of Resume guidance.
  if (notice?.kind === 'cnc-transition-unconfirmed' && status === 'disconnected') {
    return fallbackInterruption(status);
  }
  if (notice === null || notice.kind === 'cnc-transition-unconfirmed') {
    return stopRequest === null
      ? fallbackInterruption(status)
      : { kind: 'cancelled', message: jobStopRequestMessage(stopRequest.reason) };
  }
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
  // The lift's own reset kept position (ADR-411), and KerfDesk's stop that
  // ended the job left the spindle off: the job was stopped from the app, not
  // rejected by the controller (ADR-411 Amendment 1).
  if (notice.kind === 'cnc-pause-lift-failed') return 'cancelled';
  if (notice.kind === 'cnc-transition-unconfirmed') return fallbackInterruption(status).kind;
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
