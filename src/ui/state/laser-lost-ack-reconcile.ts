// laser-lost-ack-reconcile — finishes a job whose last acknowledgements were
// lost on the serial link, instead of holding it until the 90 s watchdog
// soft-resets the controller (ADR-610, Amendment 1).
//
// GRBL answers every line with exactly one `ok` or `error:N`, and the streamer
// counts them in order. A reply lost to a UART line error therefore leaves the
// LAST line of the job unacknowledged: the machine has finished, the head is
// parked, and the live bar still shows Pause and Abort. The watchdog then
// requested a soft reset, which in turn re-ran controller qualification and
// offered Reconnect — on a controller that had done nothing wrong.
//
// Nothing here acts until the whole program is on the wire, nothing else is
// owed a reply, and fresh status reports received after the last
// acknowledgement say Idle.
//
// GRBL-family controllers are then asked for proof. GRBL, grblHAL and FluidNC
// read their input strictly in order, answer `$G` in any state, and print its
// `[GC:...]` only after every earlier line has been answered
// (gnea/grbl protocol.c and system.c; grblHAL system.c `output_parser_state`;
// FluidNC ProcessSettings.cpp `anyState`). So the `[GC:` line proves that each
// job line written before the probe was read, and any reply still missing was
// lost. A controller holding lines in its own buffer (ADR-345) answers the
// probe only after them, so it is never finished early. `$G` cannot complete
// a truncated motion line: merged with one, it is rejected.
//
// A controller whose ordering is not established here falls back to a
// sustained Idle: Smoothieware handles `$G` in its shell, and how that orders
// against queued G-code has not been verified.
//
// The missing replies are then applied as acknowledgements, so the ordinary
// post-job settle runs: its own marker and stable Idle confirm completion
// exactly as for any other job. A lost reply may have been an `error:N`; the
// log says so. Nothing here resets the controller or refuses anything.

import type { StreamerState } from '../../core/controllers/grbl';
import { queuedLineCount } from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import type { ControllerKind } from '../../core/devices';
import { advanceStreamBy } from './laser-stream-ack';
import { beginPostJobSettle } from './laser-post-job-settle';
import { programmedDwellSeconds } from './laser-stream-dwell';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import { consumeUntrackedAck } from './laser-untracked-ack-ledger';
import { lostReplyProbeOutstanding, type LostReplyProbe } from './laser-lost-reply-probe';
import type { GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import type { LaserState } from './laser-store';
import { hasUnsettledStreamAcks, pushLog } from './laser-store-helpers';

/** Idle after the last reply, held this long, before a GRBL-family probe. */
export const LOST_REPLY_PROBE_AFTER_MS = 1_000;
/** Idle with no ordered probe available, held this long. */
export const LOST_ACK_IDLE_PROOF_MS = 15_000;
/** After `[GC:`, how long the probe's own `ok` may take before it counts as lost. */
export const LOST_REPLY_PROBE_REPLY_GRACE_MS = 2_000;
/** A probe whose reply the stream already took (its `[GC:` lost too). */
export const LOST_REPLY_PROBE_GIVE_UP_MS = 10_000;
const PROBE_REPORTS = 2;
const IDLE_PROOF_REPORTS = 3;
const ORDERED_PROBE_KINDS: ReadonlyArray<ControllerKind> = ['grbl-v1.1', 'grblhal', 'fluidnc'];

export type LostAckTracker = {
  /** The stream position this evidence belongs to. */
  readonly streamerEpoch: number;
  readonly sessionEpoch: number;
  readonly completed: number;
  /** Last status report counted, so one report is never counted twice. */
  lastSequence: number;
  /** Observation time of the first Idle report after the last ack. */
  firstAt: number | null;
  reports: number;
};

export type LostAckReconcileRefs = HandlerRefs & {
  lostAckTracker?: LostAckTracker | null;
  lostReplyProbe?: LostReplyProbe | null;
};

/**
 * One status-poll tick. Returns true when it applied lost acknowledgements
 * (the stream then reaches 'done' and the post-job settle starts).
 */
export function reconcileLostStreamAcknowledgements(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  now: number,
): boolean {
  if (lostReplyProbeOutstanding(refs)) return resolveOverdueProbe(set, get, refs, safeWrite, now);
  refs.lostReplyProbe = null;
  const state = get();
  const streamer = state.streamer;
  if (streamer === null || !awaitsOnlyLostReplies(state, streamer, refs)) {
    refs.lostAckTracker = null;
    return false;
  }
  const tracker = currentTracker(refs, state, streamer);
  observeReport(tracker, state);
  const probe = hasOrderedProbe(refs.driver);
  if (!proofComplete(tracker, probe, state.activeControllerKind, streamer, now)) return false;
  refs.lostAckTracker = null;
  if (probe) {
    sendLostReplyProbe(set, get, refs, safeWrite, streamer, now);
    return false;
  }
  const lost = streamer.inFlight.length;
  set((current) => ({ log: pushLog(current, sustainedIdleLogLine(lost)) }));
  applyLostReplies(set, get, refs, safeWrite, lost);
  return true;
}

/**
 * Called for every line before acknowledgement ownership is settled. Records
 * the probe's `[GC:` proof, and takes the probe's own reply so it settles the
 * probe's reservation instead of a job line. Returns true when it consumed
 * the line.
 */
export function handleLostReplyProbeLine(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  kind: string,
  line: string,
): boolean {
  if (!lostReplyProbeOutstanding(refs)) return false;
  const probe = refs.lostReplyProbe;
  if (probe == null) return false;
  if (get().controllerSessionEpoch !== probe.sessionEpoch) {
    refs.lostReplyProbe = null;
    return false;
  }
  if (probe.provenAt === null && line.trim().startsWith('[GC:')) {
    probe.provenAt = Date.now();
    return false; // The report still updates the active work offset.
  }
  if (kind !== 'ok' && kind !== 'error') return false;
  // FIFO: after `[GC:` the next terminal reply is the probe's. Without it, a
  // reply the job no longer awaits is the probe's too (its `[GC:` was lost).
  if (probe.provenAt === null && hasUnsettledStreamAcks(get().streamer)) return false;
  finishProbe(set, get, refs, safeWrite, probe);
  return true;
}

/** The whole program is on the wire, only job lines are owed replies, and
 * nothing else can be the reason those replies have not come yet. */
export function awaitsOnlyLostReplies(
  state: LaserState,
  streamer: StreamerState,
  refs: Pick<HandlerRefs, 'controllerCommand' | 'controllerIdleWait'>,
): boolean {
  return (
    state.connection.kind === 'connected' &&
    state.capabilities.statusQuery === 'realtime-report' &&
    streamer.status === 'streaming' &&
    streamer.inFlight.length > 0 &&
    queuedLineCount(streamer) === 0 &&
    nothingElseOwesReplies(state, refs)
  );
}

function nothingElseOwesReplies(
  state: LaserState,
  refs: Pick<HandlerRefs, 'controllerCommand' | 'controllerIdleWait'>,
): boolean {
  return (
    state.pendingUntrackedAcks === 0 &&
    pendingTransportWriteCount(state) === 0 &&
    state.controllerOperation === null &&
    state.motionOperation === null &&
    state.pauseResumeTransition === null &&
    state.mpgActive !== true &&
    refs.controllerCommand === null &&
    refs.controllerIdleWait === null
  );
}

/** A controller whose `$G` answer is ordered behind every earlier line. */
export function hasOrderedProbe(driver: Pick<ControllerDriver, 'kind' | 'commands'>): boolean {
  return ORDERED_PROBE_KINDS.includes(driver.kind) && driver.commands.modalStateQuery === '$G';
}

/** A current-session Idle report: the controller has nothing left to run. */
export function reportShowsIdle(
  state: Pick<LaserState, 'statusReport' | 'statusObservation' | 'controllerSessionEpoch'>,
): boolean {
  return (
    state.statusReport?.state === 'Idle' &&
    state.statusObservation?.sessionEpoch === state.controllerSessionEpoch
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
  };
  refs.lostAckTracker = tracker;
  return tracker;
}

function observeReport(tracker: LostAckTracker, state: LaserState): void {
  if (state.statusSequence === tracker.lastSequence) return;
  tracker.lastSequence = state.statusSequence;
  const observedAt = state.statusObservation?.observedAt ?? null;
  if (!reportShowsIdle(state) || observedAt === null) {
    tracker.firstAt = null;
    tracker.reports = 0;
    return;
  }
  tracker.firstAt ??= observedAt;
  tracker.reports += 1;
}

function proofComplete(
  tracker: LostAckTracker,
  probe: boolean,
  controllerKind: ControllerKind,
  streamer: StreamerState,
  now: number,
): boolean {
  if (tracker.firstAt === null) return false;
  // The probe is answered in order, behind a running G4, so it needs no
  // allowance for one; a timed proof does.
  if (probe)
    return tracker.reports >= PROBE_REPORTS && now - tracker.firstAt >= LOST_REPLY_PROBE_AFTER_MS;
  return (
    tracker.reports >= IDLE_PROOF_REPORTS &&
    now - tracker.firstAt >= LOST_ACK_IDLE_PROOF_MS + inFlightDwellMs(controllerKind, streamer)
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

function sendLostReplyProbe(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  streamer: StreamerState,
  now: number,
): void {
  const state = get();
  const probe: LostReplyProbe = {
    writeEpoch: refs.writeEpoch ?? 0,
    sessionEpoch: state.controllerSessionEpoch,
    streamerEpoch: state.streamerEpoch,
    linesBefore: streamer.completed + streamer.inFlight.length,
    sentAt: now,
    provenAt: null,
  };
  refs.lostReplyProbe = probe;
  const waiting = streamer.inFlight.length;
  set((current) => ({
    log: pushLog(
      current,
      `[lf2] The controller is Idle with ${waiting} job line ${waiting === 1 ? 'reply' : 'replies'} ` +
        'missing. Asking it to confirm it has read every line ($G).',
    ),
  }));
  void safeWrite('$G\n', 'stream-probe', 'system').catch(() => {
    // The transport's own failure handling owns the connection; the probe's
    // reservation goes with the session.
    if (refs.lostReplyProbe === probe) refs.lostReplyProbe = null;
  });
}

/** The probe's reply is overdue: its `ok` after `[GC:` was lost, or the job
 *  took it as a line reply after its `[GC:` was lost. Other waits stay with
 *  the existing watchdog. */
function resolveOverdueProbe(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  now: number,
): boolean {
  const probe = refs.lostReplyProbe;
  if (probe == null) return false;
  const state = get();
  const overdue =
    probe.provenAt === null
      ? state.streamer?.status === 'done' && now - probe.sentAt >= LOST_REPLY_PROBE_GIVE_UP_MS
      : now - probe.provenAt >= LOST_REPLY_PROBE_REPLY_GRACE_MS;
  if (!overdue) return false;
  set((current) => ({
    log: pushLog(
      current,
      '[lf2] The reply to the $G confirmation was lost on the serial link too.',
    ),
  }));
  finishProbe(set, get, refs, safeWrite, probe);
  return true;
}

function finishProbe(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  probe: LostReplyProbe,
): void {
  refs.lostReplyProbe = null;
  // Nothing was owed a reply when the probe was written, so its reservation
  // heads the ledger.
  consumeUntrackedAck(refs);
  set((state) => ({ pendingUntrackedAcks: Math.max(0, state.pendingUntrackedAcks - 1) }));
  const streamer = get().streamer;
  if (streamer === null || get().streamerEpoch !== probe.streamerEpoch) return;
  const lost = probe.provenAt === null ? 0 : Math.max(0, probe.linesBefore - streamer.completed);
  if (lost > 0) {
    set((current) => ({ log: pushLog(current, provenLostLogLine(lost)) }));
    applyLostReplies(set, get, refs, safeWrite, lost);
    return;
  }
  // The job's own replies arrived while the probe was out; its settle waited.
  if (streamer.status === 'done') beginPostJobSettle(set, get, refs, safeWrite);
}

function applyLostReplies(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  lost: number,
): void {
  let remaining = lost;
  while (remaining > 0 && get().streamer?.status === 'streaming') {
    const applied = advanceStreamBy(set, get, refs, safeWrite, 'ok', remaining);
    if (applied <= 0) break;
    remaining -= applied;
  }
}

function provenLostLogLine(lost: number): string {
  return (
    `[lf2] ${lost} job line ${lost === 1 ? 'reply was' : 'replies were'} lost on the serial link: ` +
    'the controller answered $G only after reading every line, so it had read them all. ' +
    'Finishing the job without a controller reset. A lost reply may have been an error; check the result.'
  );
}

function sustainedIdleLogLine(lost: number): string {
  return (
    `[lf2] ${lost} job line ${lost === 1 ? 'reply was' : 'replies were'} lost on the serial link: ` +
    `every line had been sent and the controller stayed Idle for ${LOST_ACK_IDLE_PROOF_MS / 1_000} s, ` +
    'so it had read them all. Finishing the job without a controller reset. ' +
    'A lost reply may have been an error; check the result.'
  );
}
