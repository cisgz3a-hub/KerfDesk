// laser-motion-reply-probe — releases a cancelled jog/Frame owner that only a
// dropped controller reply holds, in place, without a reconnect (ADR-696).
//
// grblHAL answers the jog-cancel byte 0x85, in any state, by discarding every
// line it has received but not read, and never answers those lines
// (grblHAL/core protocol.c, `hal.stream.cancel_read_buffer()`). Cancel waits
// briefly for the jog's reply before the byte (ADR-640), but a line the
// controller has not read within that grace can still be discarded. Its owed
// reply then never comes, the FIFO reply ledger cannot tell that from a late
// reply, and the owner stayed until Disconnect, whose soft reset clears a G92
// origin and leaves a homing machine locked in Alarm.
//
// GRBL, grblHAL and FluidNC read their input one line at a time and answer each
// line before they read the next (gnea/grbl and grblHAL protocol.c
// `protocol_main_loop`; FluidNC Protocol.cpp with one line in flight per
// channel). `$G` has no machine-state gate on any of them and prints its
// `[GC:...]` report before its own `ok` (ADR-610 Amendment 1). So once a
// stranded owner's controller reports Idle, KerfDesk writes one `$G`. When its
// `[GC:` arrives, every reservation written before it that is still owed was
// discarded unread: those reservations are dropped, the `ok` that follows
// settles the probe's own reservation, and the existing automatic release
// (releaseAbandonedMotionAtIdle) then confirms Idle and releases the owner.
// A reply that was only late arrives before the `[GC:` and settles normally.
//
// This runs only with no job, no command, no settlement and nothing else
// writing, so the job stream's ledger is never touched, and only on a
// GRBL-family profile whose modal query is `$G`. Firmware that has not
// identified itself waits the sustained-Idle window first, as the job probe
// does (ADR-610 Amendment 2). One probe per owner: if it is not answered, the
// owner stays and Disconnect remains available (ADR-640).

import { isTerminal } from '../../core/controllers/grbl/streamer';
import type { GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import {
  LOST_ACK_IDLE_PROOF_MS,
  LOST_REPLY_PROBE_AFTER_MS,
  LOST_REPLY_PROBE_GIVE_UP_MS,
  LOST_REPLY_PROBE_REPLY_GRACE_MS,
  lostReplyProofRule,
} from './laser-lost-ack-reconcile';
import { lostReplyProbeOutstanding, type LostReplyProbeRefs } from './laser-lost-reply-probe';
import type { LaserMotionOperationId } from './laser-motion-operation';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import { hostAwareSilenceRemainingMs } from './laser-status-poll-schedule';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import { streamOwnsTerminalAck } from './laser-stream-ack';
import {
  consumeUntrackedAck,
  dropUntrackedAcksAheadOf,
  oldestUntrackedLineMatches,
  owesUntrackedLine,
} from './laser-untracked-ack-ledger';

const PROBE_LINE = '$G';

type ProbePhase = 'waiting' | 'sent' | 'proven' | 'finished';

export type MotionReplyProbe = {
  readonly operationId: LaserMotionOperationId;
  readonly sessionEpoch: number;
  readonly writeEpoch: number;
  phase: ProbePhase;
  /** First Idle tick seen for this stranded owner; null after a busy report. */
  idleSince: number | null;
  /** When the transport accepted the `$G`; null while the write is pending. */
  writtenAt: number | null;
  /** When its `[GC:` arrived. */
  provenAt: number | null;
};

export type MotionReplyProbeRefs = HandlerRefs &
  LostReplyProbeRefs & {
    motionReplyProbe?: MotionReplyProbe | null;
  };

/** A report that is not Idle restarts the Idle window before a probe. */
export function noteStrandedMotionBusy(refs: MotionReplyProbeRefs): void {
  const probe = refs.motionReplyProbe ?? null;
  if (probe?.phase === 'waiting') probe.idleSince = null;
}

/**
 * One Idle status tick for a cancelled owner that still owes a reply. Sends the
 * `$G` once the Idle window has passed, and retires a probe whose reply is
 * overdue. The caller has checked Idle, the owner and its transport writes.
 */
export function probeStrandedMotionReply(
  set: SetFn,
  get: GetFn,
  refs: MotionReplyProbeRefs,
  safeWrite: SafeWriteFn,
  now: number,
): void {
  const state = get();
  const operationId = state.motionOperation?.operationId;
  if (operationId === undefined) return;
  const probe = currentProbe(refs, state, operationId, now);
  if (probe.phase === 'sent' || probe.phase === 'proven') {
    resolveOverdueProbe(set, refs, probe, now);
    return;
  }
  if (probe.phase !== 'waiting' || !strandedOwnerCanProbe(state, refs)) return;
  probe.idleSince ??= now;
  const windowMs = idleWindowBeforeProbeMs(state, refs);
  if (windowMs === null) return;
  if (hostAwareSilenceRemainingMs(refs.statusPollSchedule, probe.idleSince, windowMs, now) > 0) {
    return;
  }
  sendProbe(set, refs, safeWrite, probe);
}

/** The job probe's proof rule: identified GRBL-family firmware after 1 s of
 *  Idle, an unidentified board on a GRBL-family profile after the
 *  sustained-Idle window, and null where `$G` is not known to be ordered. */
function idleWindowBeforeProbeMs(state: LaserState, refs: MotionReplyProbeRefs): number | null {
  const buildInfoThisSession =
    state.controllerBuildInfo !== null &&
    state.controllerBuildInfoObservation?.sessionEpoch === state.controllerSessionEpoch;
  const rule = lostReplyProofRule(refs.driver, state.detectedControllerKind, buildInfoThisSession);
  if (rule === 'sustained-idle') return null;
  return rule === 'ordered-probe' ? LOST_REPLY_PROBE_AFTER_MS : LOST_ACK_IDLE_PROOF_MS;
}

/**
 * Called for every inbound line before reply ownership is settled; it never
 * consumes the line. On the probe's `[GC:` it drops the reservations written
 * before the `$G`, whose lines the controller discarded unread.
 */
export function handleMotionReplyProbeLine(
  set: SetFn,
  get: GetFn,
  refs: MotionReplyProbeRefs,
  line: string,
): void {
  const probe = refs.motionReplyProbe ?? null;
  if (probe === null || probe.phase !== 'sent') return;
  if (!line.trim().startsWith('[GC:')) return;
  if (
    probe.writeEpoch !== (refs.writeEpoch ?? 0) ||
    probe.sessionEpoch !== get().controllerSessionEpoch
  ) {
    refs.motionReplyProbe = null;
    return;
  }
  probe.phase = 'proven';
  probe.provenAt = Date.now();
  const dropped = dropUntrackedAcksAheadOf(refs, (sent) => sent === PROBE_LINE);
  if (dropped === 0) return;
  set((state) => ({
    pendingUntrackedAcks: Math.max(0, state.pendingUntrackedAcks - dropped),
    log: pushLog(state, droppedRepliesLogLine(dropped)),
  }));
}

/** Nothing else can be waiting on, or writing to, the controller. */
function strandedOwnerCanProbe(state: LaserState, refs: MotionReplyProbeRefs): boolean {
  return controllerIsQuiet(state) && nothingElseOwnsReplies(refs);
}

function controllerIsQuiet(state: LaserState): boolean {
  return (
    state.connection.kind === 'connected' &&
    state.capabilities.statusQuery === 'realtime-report' &&
    (state.streamer === null || isTerminal(state.streamer.status)) &&
    !streamOwnsTerminalAck(state) &&
    pendingTransportWriteCount(state) === 0 &&
    state.controllerOperation === null &&
    state.pauseResumeTransition === null &&
    state.mpgActive !== true
  );
}

function nothingElseOwnsReplies(refs: MotionReplyProbeRefs): boolean {
  return (
    refs.controllerCommand === null &&
    refs.controllerIdleWait === null &&
    refs.controllerStatusWait == null &&
    !lostReplyProbeOutstanding(refs) &&
    // A counter with no reservation behind it names no line a `$G` could
    // prove; the probe would only add a reply of its own.
    owesUntrackedLine(refs, () => true)
  );
}

function currentProbe(
  refs: MotionReplyProbeRefs,
  state: LaserState,
  operationId: LaserMotionOperationId,
  now: number,
): MotionReplyProbe {
  const previous = refs.motionReplyProbe ?? null;
  const writeEpoch = refs.writeEpoch ?? 0;
  if (
    previous !== null &&
    previous.operationId === operationId &&
    previous.sessionEpoch === state.controllerSessionEpoch &&
    previous.writeEpoch === writeEpoch
  ) {
    return previous;
  }
  const probe: MotionReplyProbe = {
    operationId,
    sessionEpoch: state.controllerSessionEpoch,
    writeEpoch,
    phase: 'waiting',
    idleSince: now,
    writtenAt: null,
    provenAt: null,
  };
  refs.motionReplyProbe = probe;
  return probe;
}

function sendProbe(
  set: SetFn,
  refs: MotionReplyProbeRefs,
  safeWrite: SafeWriteFn,
  probe: MotionReplyProbe,
): void {
  probe.phase = 'sent';
  set((state) => ({
    log: pushLog(
      state,
      `[lf2] The controller is Idle, but the cancelled ${state.motionOperation?.kind ?? 'motion'} ` +
        'is still owed a reply. Asking the controller to confirm it has read every line ($G).',
    ),
  }));
  void safeWrite(`${PROBE_LINE}\n`, undefined, 'system').then(
    () => {
      if (refs.motionReplyProbe === probe) probe.writtenAt = Date.now();
    },
    () => {
      // A rejected write may still have reached the controller, and safeWrite
      // keeps its reply reservation; its late `[GC:` still proves the order.
      // Nothing is sent again for this owner: Disconnect stays available.
    },
  );
}

/** The `ok` after `[GC:` was lost, or the `$G` was never answered at all. */
function resolveOverdueProbe(
  set: SetFn,
  refs: MotionReplyProbeRefs,
  probe: MotionReplyProbe,
  now: number,
): void {
  const schedule = refs.statusPollSchedule;
  const isProbe = (sent: string): boolean => sent === PROBE_LINE;
  if (probe.phase === 'proven' && probe.provenAt !== null) {
    if (hostAwareSilenceRemainingMs(schedule, probe.provenAt, LOST_REPLY_PROBE_REPLY_GRACE_MS, now))
      return;
    probe.phase = 'finished';
    // The controller read the `$G`; an `ok` still missing after its report
    // was lost on the link, so its reservation is released here.
    if (!oldestUntrackedLineMatches(refs, isProbe)) return;
    consumeUntrackedAck(refs);
    set((state) => ({
      pendingUntrackedAcks: Math.max(0, state.pendingUntrackedAcks - 1),
      log: pushLog(state, '[lf2] The reply to the $G confirmation was lost on the serial link.'),
    }));
    return;
  }
  if (probe.writtenAt === null) return;
  if (hostAwareSilenceRemainingMs(schedule, probe.writtenAt, LOST_REPLY_PROBE_GIVE_UP_MS, now)) {
    return;
  }
  probe.phase = 'finished';
  set((state) => ({
    log: pushLog(
      state,
      '[lf2] The controller did not answer the $G confirmation. Disconnect and connect again ' +
        'to clear the cancelled motion.',
    ),
  }));
}

function droppedRepliesLogLine(dropped: number): string {
  return (
    `[lf2] The controller answered $G only after every earlier line, so ${dropped} ` +
    `${dropped === 1 ? 'line it never answered was' : 'lines it never answered were'} ` +
    'discarded unread (grblHAL does this when a jog is cancelled). Releasing the cancelled ' +
    'motion without a reconnect.'
  );
}
