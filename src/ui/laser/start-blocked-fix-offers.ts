// Blocked-Start fix offers (maintainer, 2026-07-17: blocks must ask to fix in
// place, not dead-end in an alert). Each offer fires only when its gate is the
// SOLE refusal message — repairing one blocker cannot unblock a Start that
// other gates would still refuse, so mixed refusals keep the plain report.

import {
  RT_FEED_OV_RESET,
  RT_RAPID_OV_FULL,
  RT_SPINDLE_OV_RESET,
} from '../../core/controllers/grbl';
import { useStore } from '../state';
import { USER_ORIGIN_MISSING_MESSAGE, VERIFIED_ORIGIN_MISSING_MESSAGE } from '../job-placement';
import {
  CNC_ACCESSORY_ACTIVE_BLOCK_PREFIX,
  CNC_OVERRIDE_BLOCK_PREFIX,
} from '../state/cnc-accessory-readiness';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE } from '../state/work-z-zero-evidence';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';
import { ALARM_ACTIVE_START_MESSAGE, machineNotIdleStartMessage } from './start-machine-refusals';
import { offerZeroZForBlockedStart } from './start-blocked-zero-z-offer';
import { runFrameNow } from './use-frame-action';

/** 'retry' — the blocking condition is repaired; rerun the Start flow once.
 * 'handled' — a physical operator step is underway (the frame trace); skip
 * the refusal report, the operator re-Starts when the step completes.
 * 'unrepaired' — nothing offered or the operator declined; report as before. */
export type BlockedStartRepair = 'retry' | 'handled' | 'unrepaired';

export const PROBE_PLATE_OFFER_PROMPT =
  'The probed work zero is set, but the touch plate must be clear before the spindle starts.\n\n' +
  'Are the touch plate and probe lead removed from the stock and cutter?\n\n' +
  'OK: confirm removal and continue this Start.\n' +
  'Cancel: leave the job blocked until the plate is off.';

export const FRAME_OFFER_PROMPT =
  'Verified Origin needs a Verified Frame before Start.\n\n' +
  'OK: trace the job outline now (beam off; a CNC bit lifts to safe Z first). ' +
  'Watch that the trace stays on the stock, then press Start again.\n' +
  'Cancel: leave the job blocked.';

export const UNLOCK_OFFER_PROMPT =
  'The controller is in Alarm.\n\n' +
  'Unlock ($X) clears the alarm WITHOUT re-establishing position — only continue if the head ' +
  'is safe where it is.\n\n' +
  'OK: unlock and continue this Start.\n' +
  'Cancel: leave the job blocked.';

export const HOME_OFFER_PROMPT =
  'The controller is in Alarm.\n\n' +
  'Home ($H) runs the homing cycle to re-establish machine position. Make sure the machine ' +
  'is clear before it moves.\n\n' +
  'OK: home now and continue this Start when the cycle finishes.\n' +
  'Cancel: leave the job blocked.';

export const OVERRIDE_RESET_OFFER_PROMPT =
  'Controller feed/rapid/spindle overrides are not at 100%, so the cut would not match the ' +
  'compiled job.\n\n' +
  'OK: reset all overrides to 100% and continue this Start.\n' +
  'Cancel: leave the job blocked.';

export const SET_ORIGIN_OFFER_PROMPT =
  'No work origin is set — the job runs relative to a point you declare.\n\n' +
  'Is the head parked over the workpiece zero right now?\n\n' +
  'OK: set the origin at the current head position and continue this Start.\n' +
  'Cancel: leave the job blocked; jog the head to the workpiece zero first.';

export const ACCESSORY_STOP_OFFER_PROMPT =
  'GRBL reports the spindle or coolant still active, so the job preamble cannot own their ' +
  'state.\n\n' +
  'OK: send M5 (spindle stop) and M9 (coolant off) and continue this Start.\n' +
  'Cancel: leave the job blocked.';

export async function offerFixForBlockedStart(
  messages: ReadonlyArray<string>,
): Promise<BlockedStartRepair> {
  if (await offerZeroZForBlockedStart(messages)) return 'retry';
  // An active alarm is the one condition that legitimately refuses with two
  // messages at once (alarm state + not-Idle), so it gets an every-message
  // match instead of the sole-blocker rule.
  if (isAlarmOnlyRefusal(messages)) return offerAlarmRecovery();
  const sole = messages.length === 1 ? messages[0] : undefined;
  if (sole === undefined) return 'unrepaired';
  if (sole === PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE) return offerProbePlateConfirm();
  if (sole === frameVerificationBlockedMessage()) return offerFrameRun();
  if (sole.startsWith(CNC_OVERRIDE_BLOCK_PREFIX)) return offerOverrideReset();
  if (sole === USER_ORIGIN_MISSING_MESSAGE || sole === VERIFIED_ORIGIN_MISSING_MESSAGE) {
    return offerSetOrigin();
  }
  if (sole.startsWith(CNC_ACCESSORY_ACTIVE_BLOCK_PREFIX)) return offerAccessoryStop();
  return 'unrepaired';
}

function isAlarmOnlyRefusal(messages: ReadonlyArray<string>): boolean {
  if (messages.length === 0) return false;
  const alarmMessages: ReadonlyArray<string> = [
    ALARM_ACTIVE_START_MESSAGE,
    STATUS_ALARM_START_MESSAGE,
    machineNotIdleStartMessage('Alarm'),
  ];
  return messages.every((message) => alarmMessages.includes(message));
}

function offerProbePlateConfirm(): BlockedStartRepair {
  if (!jobAwareConfirm(PROBE_PLATE_OFFER_PROMPT)) return 'unrepaired';
  useLaserStore.getState().confirmProbePlateRemoved();
  useToastStore.getState().pushToast('Touch-plate removal confirmed.', 'success');
  return 'retry';
}

async function offerFrameRun(): Promise<BlockedStartRepair> {
  if (!jobAwareConfirm(FRAME_OFFER_PROMPT)) return 'unrepaired';
  // A refused dispatch already explained itself through the frame toasts, so
  // fall back to the plain refusal report rather than adding a second dialog.
  if (!(await runFrameNow())) return 'unrepaired';
  useToastStore
    .getState()
    .pushToast('Framing the job — watch the trace, then press Start again.', 'success');
  return 'handled';
}

// The homing question routes the alarm remedy: $H re-proves position on a
// switch-equipped machine, while a no-homing machine can only $X after the
// operator vouches for the head — the same split STATUS_ALARM_START_MESSAGE
// already instructs.
async function offerAlarmRecovery(): Promise<BlockedStartRepair> {
  const homingEnabled = useStore.getState().project.device.homing.enabled;
  return homingEnabled ? offerHomeCycle() : offerUnlock();
}

async function offerUnlock(): Promise<BlockedStartRepair> {
  if (!useLaserStore.getState().capabilities.unlock) return 'unrepaired';
  if (!jobAwareConfirm(UNLOCK_OFFER_PROMPT)) return 'unrepaired';
  try {
    await useLaserStore.getState().unlockAlarm();
  } catch (cause) {
    return repairFailed('Unlock failed', cause);
  }
  return settleThenRetry(
    (state) => state.alarmCode === null && state.statusReport?.state === 'Idle',
    'Alarm cleared.',
    'Unlock sent — press Start again once the controller reports Idle.',
  );
}

async function offerHomeCycle(): Promise<BlockedStartRepair> {
  if (!jobAwareConfirm(HOME_OFFER_PROMPT)) return 'unrepaired';
  try {
    // GRBL acks $H only after the physical cycle completes, so this await
    // spans the whole homing run.
    await useLaserStore.getState().home();
  } catch (cause) {
    return repairFailed('Homing failed', cause);
  }
  return settleThenRetry(
    (state) => state.alarmCode === null && state.statusReport?.state === 'Idle',
    'Homing complete.',
    'Homed — press Start again once the controller reports Idle.',
  );
}

async function offerOverrideReset(): Promise<BlockedStartRepair> {
  if (!useLaserStore.getState().capabilities.overrides) return 'unrepaired';
  if (!jobAwareConfirm(OVERRIDE_RESET_OFFER_PROMPT)) return 'unrepaired';
  try {
    const send = useLaserStore.getState().sendRealtimeOverride;
    await send(RT_FEED_OV_RESET);
    await send(RT_RAPID_OV_FULL);
    await send(RT_SPINDLE_OV_RESET);
  } catch (cause) {
    return repairFailed('Override reset failed', cause);
  }
  return settleThenRetry(
    (state) => isBaselineOverride(state.ovCache),
    'Controller overrides reset to 100%.',
    'Override reset sent — press Start again once overrides report 100%.',
  );
}

async function offerSetOrigin(): Promise<BlockedStartRepair> {
  if (!jobAwareConfirm(SET_ORIGIN_OFFER_PROMPT)) return 'unrepaired';
  try {
    // Waits internally (up to 3 s) for the post-G92 WCO frame, so the
    // location-unknown gate normally cannot trip on the retry.
    await useLaserStore.getState().setOriginHere();
  } catch (cause) {
    return repairFailed('Set origin failed', cause);
  }
  return settleThenRetry(
    (state) => state.workOriginActive && state.wcoCache !== null,
    'Origin set to the current head position.',
    'Origin set — press Start again once the controller reports its work offset.',
  );
}

async function offerAccessoryStop(): Promise<BlockedStartRepair> {
  if (!jobAwareConfirm(ACCESSORY_STOP_OFFER_PROMPT)) return 'unrepaired';
  try {
    const sendConsoleCommand = useLaserStore.getState().sendConsoleCommand;
    await sendConsoleCommand('M5');
    await sendConsoleCommand('M9');
  } catch (cause) {
    return repairFailed('Spindle/coolant stop failed', cause);
  }
  return settleThenRetry(
    (state) => accessoriesReportedOff(state.accessoryCache),
    'Spindle and coolant stopped.',
    'M5/M9 sent — press Start again once the status report shows them off.',
  );
}

function accessoriesReportedOff(accessories: LaserState['accessoryCache']): boolean {
  return (
    accessories != null &&
    !accessories.spindleCw &&
    !accessories.spindleCcw &&
    !accessories.flood &&
    !accessories.mist
  );
}

const OVERRIDE_BASELINE_PERCENT = 100;

function isBaselineOverride(overrides: LaserState['ovCache']): boolean {
  return (
    overrides != null &&
    overrides.feed === OVERRIDE_BASELINE_PERCENT &&
    overrides.rapid === OVERRIDE_BASELINE_PERCENT &&
    overrides.spindle === OVERRIDE_BASELINE_PERCENT
  );
}

// GRBL reflects unlock/home/override effects through the next status report,
// so a bounded settle-wait covers the poll latency. Timing out is not a
// failure: the command was accepted, so hand back 'handled' with a
// press-Start-again toast instead of the refusal alert.
const REPAIR_SETTLE_TIMEOUT_MS = 4_000;
const REPAIR_SETTLE_POLL_MS = 50;

async function settleThenRetry(
  ready: (state: LaserState) => boolean,
  settledToast: string,
  pendingToast: string,
): Promise<BlockedStartRepair> {
  const deadline = Date.now() + REPAIR_SETTLE_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    if (ready(useLaserStore.getState())) {
      useToastStore.getState().pushToast(settledToast, 'success');
      return 'retry';
    }
    await sleep(REPAIR_SETTLE_POLL_MS);
  }
  useToastStore.getState().pushToast(pendingToast, 'success');
  return 'handled';
}

function repairFailed(action: string, cause: unknown): BlockedStartRepair {
  const reason = cause instanceof Error ? cause.message : String(cause);
  useToastStore.getState().pushToast(`${action}: ${reason}`, 'warning');
  return 'unrepaired';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
