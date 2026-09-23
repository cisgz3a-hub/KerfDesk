import type { StreamerState } from '../../core/controllers/grbl';
import type { ControllerObservationStamp } from './laser-controller-observation';

// Active GRBL-family jobs are queried every 250 ms. The silence deadline
// applies while the host can run those polls; a suspended browser timer is
// not evidence that a query reached the controller and went unanswered.
export const ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS = 2_000;

// A poll tick that arrives this long after the previous one means the page
// itself was not running in between (a long task, a throttled or hidden tab,
// system sleep): nothing the controller did in that time was observed. Shared
// with the ack watchdog so neither blames the controller for the host's gap.
export const HOST_SCHEDULING_GAP_MS = ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS;

// How many scheduling gaps may each re-open a query window for one unchanged
// observation. After a stall the reply to the resumed query can wait behind a
// backlog of controller output and a second host stall (ADR-356); a bounded
// count still declares a silent controller lost if the host keeps stalling.
export const ACTIVE_STREAM_SCHEDULING_GRACES = 3;

export type ActiveStreamHeartbeatProbe = {
  readonly sessionEpoch: number;
  readonly statusSequence: number;
  readonly acknowledgedLines: number;
  readonly at: number;
  readonly checkedAt: number;
  readonly schedulingGracesUsed: number;
} | null;

/** Detects loss of fresh controller output while a host stream is active. */
export function detectActiveStreamHeartbeatLoss(
  streamer: StreamerState | null,
  observation: ControllerObservationStamp | null,
  previous: ActiveStreamHeartbeatProbe,
  now: number,
): { readonly probe: ActiveStreamHeartbeatProbe; readonly lost: boolean } {
  // `done` only means every line was parsed and acknowledged. GRBL may still
  // be executing buffered planner motion until a later Idle report releases
  // the streamer, so the transport watchdog must cover that finishing window
  // as well as ordinary streaming.
  if (streamer?.status !== 'streaming' && streamer?.status !== 'done') {
    return { probe: null, lost: false };
  }
  const current = observationIdentity(streamer, observation);
  // A fresh status report proves the link, and so does an acknowledgement:
  // the controller parsed a line the host sent and its answer arrived. After a
  // host stall the status reply sits behind a backlog of those answers.
  const changed =
    previous === null ||
    previous.sessionEpoch !== current.sessionEpoch ||
    previous.statusSequence !== current.statusSequence ||
    previous.acknowledgedLines !== current.acknowledgedLines;
  if (changed) {
    return {
      probe: { ...current, at: now, checkedAt: now, schedulingGracesUsed: 0 },
      lost: false,
    };
  }
  // Hidden tabs, a blocked event loop, or system sleep can postpone both the
  // polling callback and the serial reader. Let the resumed callback issue a
  // fresh query before treating old timestamps as a failed transport. The
  // allowance belongs to the unchanged observation and is bounded: repeated
  // late ticks cannot extend it indefinitely while the controller stays silent.
  const schedulingGap = now - previous.checkedAt >= HOST_SCHEDULING_GAP_MS;
  const retryAfterGap =
    schedulingGap && previous.schedulingGracesUsed < ACTIVE_STREAM_SCHEDULING_GRACES;
  const probe = {
    ...previous,
    at: retryAfterGap ? now : previous.at,
    checkedAt: now,
    schedulingGracesUsed: previous.schedulingGracesUsed + (retryAfterGap ? 1 : 0),
  };
  return { probe, lost: now - probe.at >= ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS };
}

function observationIdentity(
  streamer: StreamerState,
  observation: ControllerObservationStamp | null,
): {
  readonly sessionEpoch: number;
  readonly statusSequence: number;
  readonly acknowledgedLines: number;
} {
  return {
    sessionEpoch: observation?.sessionEpoch ?? -1,
    statusSequence: observation?.sequence ?? -1,
    acknowledgedLines: streamer.completed,
  };
}
