// position-kept-alarm: whether the Unlock that clears an alarm may keep the
// reported position (user annoyance audit A1, A3-P2-1; ADR-367 Amendment 3).
//
// Unlock hid the head position after every alarm but a failed probe, the soft
// limit included, whose own card says "The position is kept, so Unlock ($X) is
// safe". It now hides it only when the alarm can lose position. Keeping needs
// every one of these; anything else hides exactly as before:
//   - the alarm code is known, and every firmware this session may be running
//     (the profile's driver, the banner's, and grblHAL when its `$$` or `$I`
//     shows it) lists it as position-kept (alarm-position-kept.ts);
//   - the code is the one the last ALARM:N line raised on this connection, and
//     every reboot banner since answered a soft reset KerfDesk itself wrote:
//     stock GRBL clears its machine position at power-up, and keeps the alarm
//     code on screen through any banner (laser-reset-alarm.ts);
//   - that alarm did not come while a feed hold or door hold was on, where
//     stock GRBL and grblHAL can cut the motors and still report a soft limit
//     (alarm-position-kept.ts);
//   - the controller is not still asking for a reset.
// A failed probe keeps its own branch (probe-failure-alarm.ts).

import { alarmKeepsMachinePosition } from '../../core/controllers/grbl/alarm-position-kept';
import { grblHalEvidence } from '../../core/controllers/grblhal/grblhal-evidence';
import type { ControllerKind } from '../../core/devices';
import type { LaserState } from './laser-store';

/** What the last numbered alarm was raised under (LaserState.alarmRaised). It
 *  lasts until the Unlock that reads it, a banner KerfDesk's own reset did not
 *  cause, or the next alarm line. */
export type AlarmRaisedRecord = {
  readonly code: number;
  /** The connect attempt it was raised on (`connectionAttempt`). */
  readonly connectionAttempt: number;
  /** A feed hold or a door hold was on, or KerfDesk had paused the job. */
  readonly duringHold: boolean;
};

type AlarmRaisedInput = Pick<LaserState, 'connectionAttempt' | 'statusReport' | 'streamer'>;

/** The record handleAlarmLine keeps beside `alarmCode`, read before the alarm
 *  clears the status report. */
export function alarmRaisedPatch(
  prev: AlarmRaisedInput,
  code: number | null,
): Pick<LaserState, 'alarmRaised'> {
  if (code === null) return { alarmRaised: null };
  const reported = prev.statusReport?.state;
  return {
    alarmRaised: {
      code,
      connectionAttempt: prev.connectionAttempt ?? 0,
      duringHold: reported === 'Hold' || reported === 'Door' || prev.streamer?.status === 'paused',
    },
  };
}

export type UnlockPositionVerdict =
  | { readonly kept: true; readonly code: number }
  | { readonly kept: false; readonly reason: string };

type UnlockEvidence = Pick<
  LaserState,
  | 'activeControllerKind'
  | 'detectedControllerKind'
  | 'controllerSettings'
  | 'controllerBuildInfoRawLines'
  | 'alarmRaised'
  | 'connectionAttempt'
  | 'resetRequired'
>;

/** Whether the Unlock that clears `unlockedAlarm` keeps the reported position,
 *  and when it does not, why, for the log. */
export function unlockPositionVerdict(
  state: UnlockEvidence,
  unlockedAlarm: number | null,
): UnlockPositionVerdict {
  if (unlockedAlarm === null) return lost('no alarm code was on record');
  if (state.resetRequired === true) return lost('the controller still asked for a reset');
  if (!keptOnEveryFirmware(state, unlockedAlarm)) {
    return lost(`ALARM:${unlockedAlarm} is not known to keep the machine position`);
  }
  const raised = currentAlarmRaised(state);
  if (raised === null || raised.code !== unlockedAlarm) {
    return lost(
      `ALARM:${unlockedAlarm} was not raised on this connection, or the controller restarted since`,
    );
  }
  if (raised.duringHold) {
    return lost(`ALARM:${unlockedAlarm} came during a hold, which can stop the motors abruptly`);
  }
  return { kept: true, code: unlockedAlarm };
}

function lost(reason: string): UnlockPositionVerdict {
  return { kept: false, reason };
}

function currentAlarmRaised(state: UnlockEvidence): AlarmRaisedRecord | null {
  const raised = state.alarmRaised ?? null;
  if (raised === null) return null;
  return raised.connectionAttempt === (state.connectionAttempt ?? 0) ? raised : null;
}

// The alarm tables number codes differently (13 and 17 mean other things on
// FluidNC than on grblHAL), and a grblHAL board that sent no banner runs on the
// stock driver (grblhal-evidence.ts), so every candidate must agree.
function keptOnEveryFirmware(state: UnlockEvidence, code: number): boolean {
  return sessionFirmwares(state).every((kind) => alarmKeepsMachinePosition(kind, code));
}

function sessionFirmwares(state: UnlockEvidence): ReadonlyArray<ControllerKind> {
  const kinds: ControllerKind[] = [state.activeControllerKind];
  if (state.detectedControllerKind !== null) kinds.push(state.detectedControllerKind);
  if (grblHalEvidence(state) !== null) kinds.push('grblhal');
  return kinds;
}

/**
 * What a reboot banner leaves of the alarm on record. `ownReset`: the banner
 * answers a soft reset KerfDesk wrote (Reset, Wake, Abort), which keeps the
 * machine position; any other banner may be a power-up, which clears it, so
 * the record of how the alarm was raised goes and the next Unlock hides.
 *
 * `codeBeforeBanner` is the ALARM:N no status report followed
 * (laser-reset-alarm.ts): stock GRBL answers nothing in its critical-event
 * loop, so its soft limit already survives the reset that loop asks for.
 * grblHAL keeps answering status reports there, the code was dropped, and the
 * Unlock after the reset saw no code. A position-kept alarm that latched
 * "Reset to continue" is still the controller's lock after KerfDesk's own
 * reset: grblHAL comes back in Alarm with the same alarm and no new ALARM:N.
 * https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L167-L174
 * Not on FluidNC, which leaves its Critical state for Idle, or raises a new
 * ALARM:14 when an axis is not homed.
 * https://github.com/bdring/FluidNC/blob/fdc17a2c9c0367b07345c16da3937ff0739d4702/FluidNC/src/Protocol.cpp#L1461-L1466
 */
export function alarmAcrossBannerPatch(
  state: UnlockEvidence,
  codeBeforeBanner: number | null,
  ownReset: boolean,
): Pick<LaserState, 'alarmCode' | 'alarmRaised'> {
  const raised = ownReset ? currentAlarmRaised(state) : null;
  return { alarmCode: codeBeforeBanner ?? latchedKeptCode(state, raised), alarmRaised: raised };
}

function latchedKeptCode(state: UnlockEvidence, raised: AlarmRaisedRecord | null): number | null {
  if (raised === null || state.resetRequired !== true) return null;
  if (sessionFirmwares(state).includes('fluidnc')) return null;
  return keptOnEveryFirmware(state, raised.code) ? raised.code : null;
}
