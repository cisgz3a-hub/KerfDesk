import type { StreamerState } from '../../core/controllers/grbl';
import type { ControllerObservationStamp } from './laser-controller-observation';

// Active GRBL-family jobs are queried every 250 ms. Eight missed status
// replies distinguish a dead/degraded link from ordinary scheduling jitter.
export const ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS = 2_000;

export type ActiveStreamHeartbeatProbe = {
  readonly sessionEpoch: number;
  readonly statusSequence: number;
  readonly at: number;
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
  const probe = changed ? { ...current, at: now } : previous;
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
