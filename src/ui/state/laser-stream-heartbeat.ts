import type { StreamerState } from '../../core/controllers/grbl';
import type { ControllerObservationStamp } from './laser-controller-observation';

// Active GRBL-family jobs are queried every 250 ms. The silence deadline
// applies while the host can run those polls; a suspended browser timer is
// not evidence that a query reached the controller and went unanswered.
export const ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS = 2_000;

export type ActiveStreamHeartbeatProbe = {
  readonly sessionEpoch: number;
  readonly statusSequence: number;
  readonly at: number;
  readonly checkedAt: number;
  readonly schedulingGraceUsed: boolean;
} | null;

/** Detects loss of fresh controller status while a host stream is active. */
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
  const current = observationIdentity(observation);
  const changed =
    previous === null ||
    previous.sessionEpoch !== current.sessionEpoch ||
    previous.statusSequence !== current.statusSequence;
  if (changed) {
    return {
      probe: { ...current, at: now, checkedAt: now, schedulingGraceUsed: false },
      lost: false,
    };
  }
  // Hidden tabs, a blocked event loop, or system sleep can postpone both the
  // polling callback and the serial reader. Let the resumed callback issue
  // one fresh query before treating old timestamps as a failed transport.
  // This allowance belongs to the unchanged observation: repeated late ticks
  // cannot extend it indefinitely while the controller stays silent.
  const schedulingGap = now - previous.checkedAt >= ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS;
  const retryAfterGap = schedulingGap && !previous.schedulingGraceUsed;
  const probe = {
    ...previous,
    at: retryAfterGap ? now : previous.at,
    checkedAt: now,
    schedulingGraceUsed: previous.schedulingGraceUsed || retryAfterGap,
  };
  return { probe, lost: now - probe.at >= ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS };
}

function observationIdentity(observation: ControllerObservationStamp | null): {
  readonly sessionEpoch: number;
  readonly statusSequence: number;
} {
  return {
    sessionEpoch: observation?.sessionEpoch ?? -1,
    statusSequence: observation?.sequence ?? -1,
  };
}
