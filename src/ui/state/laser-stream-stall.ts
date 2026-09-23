// laser-stream-stall — the ack watchdog the status poll feeds each tick. Moved
// out of laser-store-helpers (still re-exported there) to keep that module
// under the size cap.

import {
  queuedLineCount,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import { HOST_SCHEDULING_GAP_MS } from './laser-stream-heartbeat';

// M13 (AUDIT-2026-06-10): ack watchdog. The streamer is purely ack-driven —
// if GRBL stops answering while lines are in flight, the job froze silently
// forever. The status poll feeds this detector each tick. Use a longer grace
// window while the controller is still in Run so slow moves do not look like
// dead USB. Feed hold / door states legitimately silence acks, so they reset
// the clock.
export const STREAM_STALL_TIMEOUT_MS = 10_000;
export const STREAM_STALL_RUNNING_TIMEOUT_MS = 90_000;

export type StallProbe = {
  readonly completed: number;
  readonly inFlightBytes: number;
  readonly queuedCount: number;
  readonly statusReport: StatusReport | null;
  readonly at: number;
  readonly checkedAt: number;
} | null;

export function detectStreamStall(
  streamer: StreamerState | null,
  statusReport: StatusReport | null,
  prev: StallProbe,
  now: number,
): { readonly probe: StallProbe; readonly stalled: boolean } {
  if (!isStallWatchActive(streamer)) return { probe: null, stalled: false };
  if (statusPausesStallWatch(statusReport)) return { probe: null, stalled: false };
  const unchanged =
    streamPositionUnchanged(prev, streamer) &&
    !freshRunStatus(prev, statusReport) &&
    !hostWasAway(prev, now);
  const at = unchanged ? prev.at : now;
  const timeoutMs = streamStallTimeoutMs(statusReport);
  return {
    probe: {
      completed: streamer.completed,
      inFlightBytes: streamer.inFlightBytes,
      queuedCount: queuedLineCount(streamer),
      statusReport,
      at,
      checkedAt: now,
    },
    stalled: now - at >= timeoutMs,
  };
}

// A tick a scheduling gap after the previous one observed nothing in between:
// the page was not running, so the unacknowledged time since then is the
// host's, not a controller hold (ADR-356). The clock restarts at this tick.
function hostWasAway(prev: StallProbe, now: number): boolean {
  return prev !== null && now - prev.checkedAt >= HOST_SCHEDULING_GAP_MS;
}

function streamStallTimeoutMs(statusReport: StatusReport | null): number {
  return statusReport?.state === 'Run' ? STREAM_STALL_RUNNING_TIMEOUT_MS : STREAM_STALL_TIMEOUT_MS;
}

function isStallWatchActive(streamer: StreamerState | null): streamer is StreamerState {
  return streamer !== null && streamer.status === 'streaming' && streamer.inFlight.length > 0;
}

function statusPausesStallWatch(statusReport: StatusReport | null): boolean {
  return statusReport?.state === 'Hold' || statusReport?.state === 'Door';
}

function freshRunStatus(prev: StallProbe, statusReport: StatusReport | null): boolean {
  return (
    prev !== null &&
    statusReport !== null &&
    prev.statusReport !== statusReport &&
    statusReport.state === 'Run'
  );
}

function streamPositionUnchanged(
  prev: StallProbe,
  streamer: StreamerState,
): prev is NonNullable<StallProbe> {
  return (
    prev !== null &&
    prev.completed === streamer.completed &&
    prev.inFlightBytes === streamer.inFlightBytes &&
    prev.queuedCount === queuedLineCount(streamer)
  );
}
