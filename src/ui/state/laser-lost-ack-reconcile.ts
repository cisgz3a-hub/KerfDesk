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
import { advanceStreamBy, streamOwnsTerminalAck } from './laser-stream-ack';
import { beginPostJobSettle } from './laser-post-job-settle';
import { programmedDwellSeconds } from './laser-stream-dwell';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import { consumeUntrackedAck } from './laser-untracked-ack-ledger';
import { lostReplyProbeOutstanding, type LostReplyProbe } from './laser-lost-reply-probe';
import {
  hostAwareSilenceRemainingMs,
  type StatusPollSchedule,
  type StatusPollScheduleRefs,
} from './laser-status-poll-schedule';
import type { GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

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

export type LostAckReconcileRefs = HandlerRefs &
  StatusPollScheduleRefs & {
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
  const probe = hasOrderedProbe(
    refs.driver,
    state.detectedControllerKind,
    grblBuildInfoThisSession(state),
  );
  const proof = { probe, kind: state.activeControllerKind, schedule: refs.statusPollSchedule };
  if (!proofComplete(tracker, proof, streamer, now)) return false;
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
 * Called for every line before acknowledgement ownership is settled; it never
 * consumes a line. On the probe's `[GC:` it applies the job's lost replies at
 * once, so the job no longer claims the next terminal reply. That reply then
 * goes through ordinary settlement, which gives it to the oldest reservation:
 * the probe's own. A command written behind the probe (an MPG fail-off) keeps
 * its reply and its owner. The probe finishes after that reply is settled.
 */
export function handleLostReplyProbeLine(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  kind: string,
  line: string,
): void {
  if (!lostReplyProbeOutstanding(refs)) return;
  const probe = refs.lostReplyProbe;
  if (probe == null || probe.replied) return;
  if (get().controllerSessionEpoch !== probe.sessionEpoch) {
    refs.lostReplyProbe = null;
    return;
  }
  if (probe.provenAt === null && line.trim().startsWith('[GC:')) {
    probe.provenAt = Date.now();
    applyProvenLostReplies(set, get, refs, safeWrite, probe);
    return; // The report still updates the active work offset.
  }
  if (kind !== 'ok' && kind !== 'error') return;
  // The probe's reply is the first one the job no longer claims: after `[GC:`
  // the job's lost replies are applied, and without it (its `[GC:` was lost)
  // the job has its own replies already. While the job still claims a reply,
  // ordinary routing gives it to the job, so the probe must not count it.
  if (streamOwnsTerminalAck(get())) return;
  probe.replied = true;
  queueMicrotask(() => {
    if (refs.lostReplyProbe === probe) finishProbe(set, get, refs, safeWrite, probe, false);
  });
}

function applyProvenLostReplies(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  probe: LostReplyProbe,
): void {
  const state = get();
  const streamer = state.streamer;
  if (streamer === null || state.streamerEpoch !== probe.streamerEpoch) return;
  // A Pause pressed while the probe was out leaves the job paused: it drains
  // the applied replies and stays paused until Resume completes it.
  if (streamer.status !== 'streaming' && streamer.status !== 'paused') return;
  const lost = Math.max(0, probe.linesBefore - streamer.completed);
  if (lost === 0) return;
  set((current) => ({ log: pushLog(current, provenLostLogLine(lost)) }));
  // A streaming job reaches 'done'; its settle and Idle release wait for the probe.
  applyLostReplies(set, get, refs, safeWrite, lost);
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

/** A controller whose `$G` answer is ordered behind every earlier line. The
 *  profile's driver stays in use whatever firmware actually answers (a banner
 *  mismatch is only an advisory), so the firmware itself must be identified as
 *  GRBL, grblHAL or FluidNC in this session: by its banner or, when it printed
 *  none, by a stock GRBL `$I` reply. Unidentified firmware gets the sustained-
 *  Idle rule. */
export function hasOrderedProbe(
  driver: Pick<ControllerDriver, 'kind' | 'commands'>,
  detectedKind: ControllerKind | null,
  grblBuildInfoSeen = false,
): boolean {
  const identified =
    detectedKind !== null ? ORDERED_PROBE_KINDS.includes(detectedKind) : grblBuildInfoSeen;
  return (
    identified &&
    ORDERED_PROBE_KINDS.includes(driver.kind) &&
    driver.commands.modalStateQuery === '$G'
  );
}

function grblBuildInfoThisSession(state: LaserState): boolean {
  return (
    state.controllerBuildInfo !== null &&
    state.controllerBuildInfoObservation?.sessionEpoch === state.controllerSessionEpoch
  );
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

type ProofRule = {
  readonly probe: boolean;
  readonly kind: ControllerKind;
  readonly schedule: StatusPollSchedule | null | undefined;
};

function proofComplete(
  tracker: LostAckTracker,
  rule: ProofRule,
  streamer: StreamerState,
  now: number,
): boolean {
  if (tracker.firstAt === null) return false;
  // The probe is answered in order, behind a running G4, so it needs no
  // allowance for one; a timed proof does.
  const reports = rule.probe ? PROBE_REPORTS : IDLE_PROOF_REPORTS;
  const window = rule.probe
    ? LOST_REPLY_PROBE_AFTER_MS
    : LOST_ACK_IDLE_PROOF_MS + inFlightDwellMs(rule.kind, streamer);
  return (
    tracker.reports >= reports && onScheduleElapsed(rule.schedule, tracker.firstAt, window, now)
  );
}

// Only time the status poll ran on schedule counts: after a hidden, throttled
// or sleeping page resumes, replies queued meanwhile are still being read, so
// every window restarts from that tick (ADR-356 Amendment 1).
function onScheduleElapsed(
  schedule: StatusPollSchedule | null | undefined,
  since: number,
  windowMs: number,
  now: number,
): boolean {
  return hostAwareSilenceRemainingMs(schedule, since, windowMs, now) === 0;
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
    writtenAt: null,
    provenAt: null,
    streamEndedAt: null,
    replied: false,
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
  void safeWrite('$G\n', 'stream-probe', 'system').then(
    () => {
      // Until the transport accepts the probe no reply can be due, so the
      // give-up below counts from here.
      if (refs.lostReplyProbe === probe) probe.writtenAt = Date.now();
    },
    () => {
      // Keep the probe. A rejected write may still have reached the
      // controller, and safeWrite then keeps the probe's reply reservation in
      // quarantine; its late `[GC:` and `ok` must still find their owner. Every
      // other rejection moves the write epoch, which retires both together.
    },
  );
}

/** The probe's reply is overdue: its `ok` after `[GC:` was lost, or every
 *  line of its answer was lost once the job had ended. While the job still
 *  streams, the existing watchdog governs instead. */
function resolveOverdueProbe(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  now: number,
): boolean {
  const probe = refs.lostReplyProbe;
  if (probe == null || probe.replied) return false;
  const state = get();
  const schedule = refs.statusPollSchedule;
  const streaming =
    state.streamer?.status === 'streaming' && state.streamerEpoch === probe.streamerEpoch;
  // A held program may keep the job streaming far longer than any grace; the
  // clock starts only once the job has ended (done, errored or released).
  if (!streaming) probe.streamEndedAt ??= now;
  const overdue =
    probe.provenAt !== null
      ? onScheduleElapsed(schedule, probe.provenAt, LOST_REPLY_PROBE_REPLY_GRACE_MS, now)
      : probe.writtenAt !== null &&
        probe.streamEndedAt !== null &&
        onScheduleElapsed(
          schedule,
          Math.max(probe.writtenAt, probe.streamEndedAt),
          LOST_REPLY_PROBE_GIVE_UP_MS,
          now,
        );
  if (!overdue) return false;
  set((current) => ({
    log: pushLog(
      current,
      '[lf2] The reply to the $G confirmation was lost on the serial link too.',
    ),
  }));
  finishProbe(set, get, refs, safeWrite, probe, true);
  return true;
}

/** Retires the probe. `replyLost`: its reply never came, so its reservation is
 *  released here; otherwise ordinary settlement already took it. */
function finishProbe(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  probe: LostReplyProbe,
  replyLost: boolean,
): void {
  refs.lostReplyProbe = null;
  if (replyLost) {
    // Nothing was owed a reply when the probe was written, so its
    // reservation heads the ledger.
    consumeUntrackedAck(refs);
    set((state) => ({ pendingUntrackedAcks: Math.max(0, state.pendingUntrackedAcks - 1) }));
  }
  // The job ended while the probe was out; its settle waited for this.
  const state = get();
  if (state.streamer?.status === 'done' && state.streamerEpoch === probe.streamerEpoch) {
    beginPostJobSettle(set, get, refs, safeWrite);
  }
}

function applyLostReplies(
  set: SetFn,
  get: GetFn,
  refs: LostAckReconcileRefs,
  safeWrite: SafeWriteFn,
  lost: number,
): void {
  let remaining = lost;
  const accepts = (): boolean => ['streaming', 'paused'].includes(get().streamer?.status ?? '');
  while (remaining > 0 && accepts()) {
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
