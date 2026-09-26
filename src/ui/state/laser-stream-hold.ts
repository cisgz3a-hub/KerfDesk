// laser-stream-hold — names the state where the controller keeps answering
// status queries but has stopped acknowledging the lines already sent to it.
//
// The ack watchdog (`detectStreamStall`) only knew how to raise a safety
// notice, and the copy of that notice described the transport-loss path (a
// frozen stream and a requested soft reset) that this path never takes. On a
// Creality Falcon A1 Pro the maintainer saw the machine sit Idle for about a
// minute mid-burn and then carry on by itself: the link was alive the whole
// time and the sender was simply waiting for the controller. The live bar now
// says exactly that, with the count and the age of the unacknowledged lines,
// the log records the facts once per episode, and the safety notice is kept
// for the case that never resolves.
//
// Nothing here writes to the controller or refuses anything (rule 7 /
// ADR-228): it is telemetry about a wait the app was already doing (ADR-345).

import type { StreamerState } from '../../core/controllers/grbl';
import type { LaserSafetyNotice } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import {
  detectStreamStall,
  STREAM_STALL_RUNNING_TIMEOUT_MS,
  type StallProbe,
} from './laser-stream-stall';
import { hostedRefillArmed } from './laser-hosted-refill';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import { programmedDwellSeconds } from './laser-stream-dwell';

type StallObservationRefs = Parameters<typeof hostedRefillArmed>[0] & {
  stallProbe: StallProbe;
  controllerBusyAt?: number | null;
};

/**
 * One poll tick of the ack watchdog: advance the stall probe, then publish the
 * hold it describes (or its end). Publishes nothing while no job is held.
 */
export function observeStreamHoldTick(
  set: (patch: Partial<Pick<LaserState, 'streamHold' | 'log' | 'safetyNotice'>>) => void,
  state: LaserState,
  refs: StallObservationRefs,
  now: number,
): void {
  // Only a controller that is not polled while it streams relies on its busy
  // keepalive to show it is working (MA-9).
  const busyAt =
    state.capabilities.statusQuery === 'queued-poll' ? (refs.controllerBusyAt ?? null) : null;
  const stall = detectStreamStall(state.streamer, state.statusReport, refs.stallProbe, now, busyAt);
  refs.stallProbe = stall.probe;
  const hold = streamHoldFromProbe(state, stall.probe, now);
  if (hold !== null || (state.streamHold ?? null) !== null) set(streamHoldPatch(state, refs, hold));
}

/** How long the sent lines must go unacknowledged before the bar names it. */
export const STREAM_HOLD_VISIBLE_MS = 3_000;
/** How long before the wait is also raised as a safety notice, in any state. */
export const STREAM_HOLD_NOTICE_MS = STREAM_STALL_RUNNING_TIMEOUT_MS;
/** How much longer than its programmed time a G4 dwell may go unanswered
 * before it is named as a hold: status poll and serial latency. */
export const STREAM_DWELL_MARGIN_MS = 2_000;

export type StreamHold = {
  /** Epoch ms when the sender last saw an acknowledgement or fresh Run status. */
  readonly since: number;
  /** Epoch ms of the poll tick that produced this record. */
  readonly observedAt: number;
  readonly unacknowledgedLines: number;
  readonly unacknowledgedBytes: number;
  /** The state a status report received during this wait gave; null when no
   * report arrived in it (MA-9: never a report from before the wait). */
  readonly controllerState: string | null;
  /** Set when KerfDesk does not poll this controller's status while a job
   * streams (Marlin's M114 is a queued line). */
  readonly statusNotPolled?: true;
  /** Set while the oldest unacknowledged line is a programmed G4 dwell still
   * inside its time plus a margin: the controller is dwelling, as told, not
   * holding the program (ST-5). */
  readonly dwellSeconds?: number;
};

type HoldSource = Pick<
  LaserState,
  'streamer' | 'statusReport' | 'statusObservation' | 'capabilities' | 'activeControllerKind'
>;

/** The hold the current stall probe describes, or null when the stream is
 * being acknowledged (or is not streaming at all). */
export function streamHoldFromProbe(
  state: HoldSource,
  probe: StallProbe,
  now: number,
): StreamHold | null {
  const streamer: StreamerState | null = state.streamer;
  if (probe === null || streamer === null || streamer.status !== 'streaming') return null;
  if (streamer.inFlight.length === 0) return null;
  if (now - probe.at < STREAM_HOLD_VISIBLE_MS) return null;
  const dwell = programmedDwellSeconds(state.activeControllerKind, streamer.inFlight[0]?.line);
  const dwelling = dwell !== null && now - probe.at < dwell * 1_000 + STREAM_DWELL_MARGIN_MS;
  return {
    since: probe.at,
    observedAt: now,
    unacknowledgedLines: streamer.inFlight.length,
    unacknowledgedBytes: streamer.inFlightBytes,
    controllerState: freshControllerState(state, probe.at),
    ...(state.capabilities.statusQuery === 'queued-poll' ? { statusNotPolled: true as const } : {}),
    ...(dwelling ? { dwellSeconds: dwell } : {}),
  };
}

function freshControllerState(state: HoldSource, since: number): string | null {
  const observedAt = state.statusObservation?.observedAt;
  return observedAt !== undefined && observedAt >= since
    ? (state.statusReport?.state ?? null)
    : null;
}

export function streamHoldSeconds(hold: StreamHold): number {
  return Math.max(0, Math.round((hold.observedAt - hold.since) / 1000));
}

/** Only the age moves between two ticks of one episode; a new episode, the
 * end of one, or a dwell that outlasts its time changes its identity. */
export function sameStreamHoldEpisode(a: StreamHold | null, b: StreamHold | null): boolean {
  if (a === null || b === null) return a === b;
  return a.since === b.since && isStreamDwell(a) === isStreamDwell(b);
}

/** The controller is running a programmed dwell, not holding the program. */
export function isStreamDwell(hold: StreamHold): boolean {
  return hold.dwellSeconds !== undefined;
}

/** The live bar's heading for the wait. */
export function streamHoldHeading(hold: StreamHold): string {
  return isStreamDwell(hold) ? 'DWELLING (SPINDLE SPIN-UP)' : 'CONTROLLER HOLDING PROGRAM';
}

/**
 * The store patch for one poll tick: the hold itself (refreshed every tick
 * while it lasts so the bar's timer moves), one log line when an episode
 * begins with the facts a bug report needs, one when it ends with how long it
 * took, and the safety notice once the wait outlasts the watchdog window.
 */
export function streamHoldPatch(
  state: LaserState,
  refs: Parameters<typeof hostedRefillArmed>[0],
  hold: StreamHold | null,
): Partial<Pick<LaserState, 'streamHold' | 'log' | 'safetyNotice'>> {
  const previous = state.streamHold ?? null;
  const patch: {
    streamHold: StreamHold | null;
    log?: LaserState['log'];
    safetyNotice?: LaserSafetyNotice;
  } = { streamHold: hold };
  const logLine = sameStreamHoldEpisode(previous, hold)
    ? null
    : episodeLogLine(state, refs, previous, hold);
  if (logLine !== null) patch.log = pushLog(state, logLine);
  if (
    hold !== null &&
    !isStreamDwell(hold) &&
    state.safetyNotice === null &&
    hold.observedAt - hold.since >= STREAM_HOLD_NOTICE_MS
  ) {
    patch.safetyNotice = controllerUnresponsiveNotice(hold);
  }
  return patch;
}

// A dwell is the controller doing what it was told, so it is not logged as a
// hold; a dwell that outlasts its time starts a hold episode that is.
function episodeLogLine(
  state: LaserState,
  refs: Parameters<typeof hostedRefillArmed>[0],
  previous: StreamHold | null,
  hold: StreamHold | null,
): string | null {
  if (hold !== null) return isStreamDwell(hold) ? null : holdBeganLine(state, refs, hold);
  return previous === null || isStreamDwell(previous) ? null : holdEndedLine(previous);
}

function holdBeganLine(
  state: LaserState,
  refs: Parameters<typeof hostedRefillArmed>[0],
  hold: StreamHold,
): string {
  const streamer = state.streamer;
  const queued = streamer === null ? 0 : Math.max(0, streamer.queued.length - streamer.queueIndex);
  const buffer = state.statusReport?.buffer;
  const bufferText =
    buffer === null || buffer === undefined
      ? 'no Bf field'
      : `Bf ${buffer.plannerBlocksFree} blocks / ${buffer.rxBytesFree} B free`;
  return (
    `[lf2] Controller holding program: ${holdStatusPhrase(hold)} ` +
    `${hold.unacknowledgedLines} sent lines (${hold.unacknowledgedBytes} B) unacknowledged ` +
    `for ${streamHoldSeconds(hold)} s; window ${streamer?.rxBufferBytes ?? 0} B; ` +
    `${streamer?.completed ?? 0} acknowledged, ${queued} queued; ${bufferText}; ` +
    `untracked acks owed ${state.pendingUntrackedAcks}, transport writes pending ` +
    `${pendingTransportWriteCount(state)}, refill ${hostedRefillArmed(refs) ? 'worker' : 'host'}. ` +
    'KerfDesk is connected and waiting; it has not reset the controller.'
  );
}

function holdStatusPhrase(hold: StreamHold): string {
  if (hold.controllerState !== null) return `reports ${hold.controllerState} with`;
  return hold.statusNotPolled === true
    ? 'no status is polled while it streams, with'
    : 'no fresh status report, with';
}

function holdEndedLine(previous: StreamHold): string {
  return `[lf2] Controller resumed acknowledging after holding the program for ${streamHoldSeconds(previous)} s.`;
}

// Names only a status report received during the wait (MA-9): a controller
// that is not polled while it streams was never asked.
function holdEvidenceClause(hold: StreamHold): string {
  if (hold.controllerState !== null) {
    return ` while still answering status queries (reporting ${hold.controllerState})`;
  }
  return hold.statusNotPolled === true
    ? " and sent no busy report meanwhile; KerfDesk does not poll this controller's status while a job streams"
    : ' and sent no status report meanwhile';
}

export function controllerUnresponsiveNotice(hold: StreamHold): LaserSafetyNotice {
  return {
    kind: 'stream-stalled',
    message:
      `The controller has not acknowledged the last ${hold.unacknowledgedLines} lines KerfDesk sent ` +
      `for ${streamHoldSeconds(hold)} s${holdEvidenceClause(hold)}. KerfDesk is ` +
      'connected and waiting; it has not reset the controller and no job bytes were dropped. ' +
      'A machine holding its own program can continue on its own (on a Creality Falcon A1 the ' +
      "firmware's standby timer, $152, is a known cause); if it does not, abort the job, check " +
      'the machine and the USB link, then re-run.',
  };
}

/** Operator-facing sentence for the live bar. */
export function describeStreamHold(hold: StreamHold, falconAirTimerHint: boolean): string {
  if (hold.dwellSeconds !== undefined) {
    return (
      `The controller is running the program's ${hold.dwellSeconds} s G4 dwell ` +
      `(${streamHoldSeconds(hold)} s so far). KerfDesk is connected and waiting; nothing was reset`
    );
  }
  const base =
    `${holdBarLead(hold)} has not acknowledged the last ` +
    `${hold.unacknowledgedLines} sent lines for ${streamHoldSeconds(hold)} s. ` +
    'KerfDesk is connected and waiting; nothing was reset';
  return falconAirTimerHint
    ? `${base}. On a Creality A1 this is usually the firmware's own standby timer — send $152=100 from the Console after the job`
    : base;
}

function holdBarLead(hold: StreamHold): string {
  if (hold.controllerState !== null) return `The controller reports ${hold.controllerState} and`;
  return hold.statusNotPolled === true
    ? 'The controller, whose status is not polled while it streams,'
    : 'The controller has sent no fresh status report and';
}
