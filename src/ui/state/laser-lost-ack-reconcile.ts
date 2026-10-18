// laser-lost-ack-reconcile — finishes a job whose last acknowledgements were
// lost on the serial link, instead of holding it until the 90 s watchdog
// soft-resets the controller (ADR-606).
//
// GRBL answers every line with exactly one `ok` or `error:N`, and the streamer
// counts them in order. A reply lost to a UART line error therefore leaves the
// LAST line of the job unacknowledged: the machine has finished, the head is
// parked, and the live bar still shows Pause and Abort. The watchdog then
// requested a soft reset, which in turn re-ran controller qualification and
// offered Reconnect — on a controller that had done nothing wrong.
//
// This module ends that wait only on evidence that the controller has read
// every byte the host sent: the whole program is on the wire, nothing else is
// owed a reply, and fresh status reports received after the last
// acknowledgement say Idle. When the report carries `Bf`, its receive buffer
// and planner must be as empty as this session's quiescent Idle showed them
// (laser-rx-capacity-evidence.ts), which also tells a controller holding its
// own program (ADR-345: Idle while lines wait in its buffer) apart from a lost
// reply. Without `Bf` (stock GRBL and FluidNC at `$10=1`) a sustained Idle is
// required instead. A programmed G4 still in flight extends either window.
//
// The missing replies are then applied as acknowledgements, so the ordinary
// post-job settle runs: its own marker and stable Idle confirm completion
// exactly as for any other job. A lost reply may have been an `error:N`; the
// log says so. Nothing here resets the controller or refuses anything.

import type { StatusReport, StreamerState } from '../../core/controllers/grbl';
import { queuedLineCount } from '../../core/controllers/grbl';
import type { ControllerKind } from '../../core/devices';
import { advanceStreamBy } from './laser-stream-ack';
import { programmedDwellSeconds } from './laser-stream-dwell';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import {
  currentPlannerCapacityEvidence,
  currentRxCapacityEvidence,
} from './laser-rx-capacity-evidence';
import type { GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

/** Idle with an empty receive buffer and planner, held this long. */
export const LOST_ACK_BUFFER_PROOF_MS = 8_000;
/** Idle with no buffer report, held this long. */
export const LOST_ACK_IDLE_PROOF_MS = 15_000;
const BUFFER_PROOF_REPORTS = 2;
const IDLE_PROOF_REPORTS = 3;

type Proof = 'buffer' | 'idle';

export type LostAckTracker = {
  /** The stream position this evidence belongs to. */
  readonly streamerEpoch: number;
  readonly sessionEpoch: number;
  readonly completed: number;
  /** Last status report counted, so one report is never counted twice. */
  lastSequence: number;
  /** Observation time of the first qualifying report, after the last ack. */
  firstAt: number | null;
  reports: number;
  /** Every counted report carried an empty `Bf`. */
  bufferProof: boolean;
};

export type LostAckReconcileRefs = HandlerRefs & { lostAckTracker?: LostAckTracker | null };

/**
 * One status-poll tick. Returns true when it applied the lost acknowledgements
 * (the stream then reaches 'done' and the post-job settle starts).
 */
export function reconcileLostStreamAcknowledgements(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  now: number,
): boolean {
  const state = get();
  const streamer = state.streamer;
  if (streamer === null || !awaitsOnlyLostReplies(state, streamer)) {
    refs.lostAckTracker = null;
    return false;
  }
  const tracker = currentTracker(refs, state, streamer);
  observeReport(tracker, state);
  if (!proofComplete(tracker, state.activeControllerKind, streamer, now)) return false;
  const lost = streamer.inFlight.length;
  refs.lostAckTracker = null;
  set((current) => ({ log: pushLog(current, lostRepliesLogLine(lost, tracker.bufferProof)) }));
  let remaining = lost;
  while (remaining > 0 && get().streamer?.status === 'streaming') {
    const applied = advanceStreamBy(set, get, refs, safeWrite, 'ok', remaining);
    if (applied <= 0) break;
    remaining -= applied;
  }
  return true;
}

/** The whole program is on the wire, only job lines are owed replies, and
 * nothing else can be the reason those replies have not come yet. */
export function awaitsOnlyLostReplies(state: LaserState, streamer: StreamerState): boolean {
  return (
    state.connection.kind === 'connected' &&
    state.capabilities.statusQuery === 'realtime-report' &&
    streamer.status === 'streaming' &&
    streamer.inFlight.length > 0 &&
    queuedLineCount(streamer) === 0 &&
    state.pendingUntrackedAcks === 0 &&
    pendingTransportWriteCount(state) === 0 &&
    state.controllerOperation === null &&
    state.motionOperation === null &&
    state.pauseResumeTransition === null &&
    state.mpgActive !== true
  );
}

function currentTracker(
  refs: LostAckReconcileRefs,
  state: LaserState,
  streamer: StreamerState,
): LostAckTracker {
  const previous = refs.lostAckTracker ?? null;
  if (
    previous !== null &&
    previous.streamerEpoch === state.streamerEpoch &&
    previous.sessionEpoch === state.controllerSessionEpoch &&
    previous.completed === streamer.completed
  ) {
    return previous;
  }
  // A new position: only reports that arrive from here on can describe it.
  const tracker: LostAckTracker = {
    streamerEpoch: state.streamerEpoch,
    sessionEpoch: state.controllerSessionEpoch,
    completed: streamer.completed,
    lastSequence: state.statusSequence,
    firstAt: null,
    reports: 0,
    bufferProof: true,
  };
  refs.lostAckTracker = tracker;
  return tracker;
}

function observeReport(tracker: LostAckTracker, state: LaserState): void {
  if (state.statusSequence === tracker.lastSequence) return;
  tracker.lastSequence = state.statusSequence;
  const proof = reportProof(state);
  const observedAt = state.statusObservation?.observedAt ?? null;
  if (proof === null || observedAt === null) {
    tracker.firstAt = null;
    tracker.reports = 0;
    tracker.bufferProof = true;
    return;
  }
  tracker.firstAt ??= observedAt;
  tracker.reports += 1;
  tracker.bufferProof &&= proof === 'buffer';
}

/** What the current report proves about the controller's input, if anything. */
export function reportProof(
  state: Pick<
    LaserState,
    | 'statusReport'
    | 'statusObservation'
    | 'controllerSessionEpoch'
    | 'rxCapacityEvidence'
    | 'plannerCapacityEvidence'
  >,
): Proof | null {
  const report: StatusReport | null = state.statusReport;
  if (report?.state !== 'Idle') return null;
  if (state.statusObservation?.sessionEpoch !== state.controllerSessionEpoch) return null;
  const buffer = report.buffer ?? null;
  if (buffer === null) return 'idle';
  // A buffer report that shows anything still queued, or one this session has
  // no quiescent baseline for, proves nothing.
  const rx = currentRxCapacityEvidence(state);
  const planner = currentPlannerCapacityEvidence(state);
  if (rx === null || planner === null) return null;
  return buffer.rxBytesFree >= rx.rxBytesFree &&
    buffer.plannerBlocksFree >= planner.plannerBlocksFree
    ? 'buffer'
    : null;
}

function proofComplete(
  tracker: LostAckTracker,
  controllerKind: ControllerKind,
  streamer: StreamerState,
  now: number,
): boolean {
  if (tracker.firstAt === null) return false;
  const reports = tracker.bufferProof ? BUFFER_PROOF_REPORTS : IDLE_PROOF_REPORTS;
  const window = tracker.bufferProof ? LOST_ACK_BUFFER_PROOF_MS : LOST_ACK_IDLE_PROOF_MS;
  return (
    tracker.reports >= reports &&
    now - tracker.firstAt >= window + inFlightDwellMs(controllerKind, streamer)
  );
}

// GRBL may report Idle while it runs a G4, and answers the G4 only after it.
function inFlightDwellMs(controllerKind: ControllerKind, streamer: StreamerState): number {
  let seconds = 0;
  for (const { line } of streamer.inFlight) {
    seconds += programmedDwellSeconds(controllerKind, line) ?? 0;
  }
  return seconds * 1_000;
}

function lostRepliesLogLine(lost: number, bufferProof: boolean): string {
  const evidence = bufferProof
    ? 'reported Idle with an empty receive buffer and planner'
    : `stayed Idle for ${LOST_ACK_IDLE_PROOF_MS / 1_000} s`;
  return (
    `[lf2] ${lost} job line ${lost === 1 ? 'reply was' : 'replies were'} lost on the serial link: ` +
    `every line had been sent and the controller ${evidence}, so it had read them all. ` +
    'Finishing the job without a controller reset. A lost reply may have been an error; check the result.'
  );
}
