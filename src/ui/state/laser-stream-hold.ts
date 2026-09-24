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

type StallObservationRefs = Parameters<typeof hostedRefillArmed>[0] & { stallProbe: StallProbe };

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
  const stall = detectStreamStall(state.streamer, state.statusReport, refs.stallProbe, now);
  refs.stallProbe = stall.probe;
  const hold = streamHoldFromProbe(state, stall.probe, now);
  if (hold !== null || (state.streamHold ?? null) !== null) set(streamHoldPatch(state, refs, hold));
}

/** How long the sent lines must go unacknowledged before the bar names it. */
export const STREAM_HOLD_VISIBLE_MS = 3_000;
/** How long before the wait is also raised as a safety notice, in any state. */
export const STREAM_HOLD_NOTICE_MS = STREAM_STALL_RUNNING_TIMEOUT_MS;

export type StreamHold = {
  /** Epoch ms when the sender last saw an acknowledgement or fresh Run status. */
  readonly since: number;
  /** Epoch ms of the poll tick that produced this record. */
  readonly observedAt: number;
  readonly unacknowledgedLines: number;
  readonly unacknowledgedBytes: number;
  readonly controllerState: string | null;
};

type HoldSource = Pick<LaserState, 'streamer' | 'statusReport'>;

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
  return {
    since: probe.at,
    observedAt: now,
    unacknowledgedLines: streamer.inFlight.length,
    unacknowledgedBytes: streamer.inFlightBytes,
    controllerState: state.statusReport?.state ?? null,
  };
}

export function streamHoldSeconds(hold: StreamHold): number {
  return Math.max(0, Math.round((hold.observedAt - hold.since) / 1000));
}

/** Only the age moves between two ticks of one episode; a new episode, or
 * the end of one, changes the record's identity fields. */
export function sameStreamHoldEpisode(a: StreamHold | null, b: StreamHold | null): boolean {
  if (a === null || b === null) return a === b;
  return a.since === b.since;
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
  if (!sameStreamHoldEpisode(previous, hold)) {
    if (hold !== null) patch.log = pushLog(state, holdBeganLine(state, refs, hold));
    else if (previous !== null) patch.log = pushLog(state, holdEndedLine(previous));
  }
  if (
    hold !== null &&
    state.safetyNotice === null &&
    hold.observedAt - hold.since >= STREAM_HOLD_NOTICE_MS
  ) {
    patch.safetyNotice = controllerUnresponsiveNotice(hold);
  }
  return patch;
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
    `[lf2] Controller holding program: reports ${hold.controllerState ?? 'no status'} ` +
    `with ${hold.unacknowledgedLines} sent lines (${hold.unacknowledgedBytes} B) unacknowledged ` +
    `for ${streamHoldSeconds(hold)} s; window ${streamer?.rxBufferBytes ?? 0} B; ` +
    `${streamer?.completed ?? 0} acknowledged, ${queued} queued; ${bufferText}; ` +
    `untracked acks owed ${state.pendingUntrackedAcks}, transport writes pending ` +
    `${pendingTransportWriteCount(state)}, refill ${hostedRefillArmed(refs) ? 'worker' : 'host'}. ` +
    'KerfDesk is connected and waiting; it has not reset the controller.'
  );
}

function holdEndedLine(previous: StreamHold): string {
  return `[lf2] Controller resumed acknowledging after holding the program for ${streamHoldSeconds(previous)} s.`;
}

export function controllerUnresponsiveNotice(hold: StreamHold): LaserSafetyNotice {
  return {
    kind: 'stream-stalled',
    message:
      `The controller has not acknowledged the last ${hold.unacknowledgedLines} lines KerfDesk sent ` +
      `for ${streamHoldSeconds(hold)} s while still answering status queries` +
      `${hold.controllerState === null ? '' : ` (reporting ${hold.controllerState})`}. KerfDesk is ` +
      'connected and waiting; it has not reset the controller and no job bytes were dropped. ' +
      'A machine holding its own program can continue on its own (on a Creality Falcon A1 the ' +
      "firmware's standby timer, $152, is a known cause); if it does not, abort the job, check " +
      'the machine and the USB link, then re-run.',
  };
}

/** Operator-facing sentence for the live bar. */
export function describeStreamHold(hold: StreamHold, falconAirTimerHint: boolean): string {
  const state = hold.controllerState ?? 'no status';
  const base =
    `The controller reports ${state} and has not acknowledged the last ` +
    `${hold.unacknowledgedLines} sent lines for ${streamHoldSeconds(hold)} s. ` +
    'KerfDesk is connected and waiting; nothing was reset';
  return falconAirTimerHint
    ? `${base}. On a Creality A1 this is usually the firmware's own standby timer — set $152=100 on the controller`
    : base;
}
