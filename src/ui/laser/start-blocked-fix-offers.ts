// Blocked-Start fix offers (maintainer, 2026-07-17: frame-first — Frame is
// the ONLY Start guard; blocks must ask to fix in place, not dead-end in an
// alert). Under frame-first the refusals that remain are transport state
// (alarm), compile inputs (origins — offered by the sibling setup module),
// and the Frame gate itself, whose offer runs the trace right here. Each
// offer fires only when its gate is the SOLE refusal message — repairing one
// blocker cannot unblock a Start that other gates would still refuse.

import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
import { STATUS_ALARM_START_MESSAGE } from './start-job-readiness';
import { ALARM_ACTIVE_START_MESSAGE, machineNotIdleStartMessage } from './start-machine-refusals';
import { repairFailed, settleThenRetry, type BlockedStartRepair } from './start-blocked-repair';
import { offerSetupFixForBlockedStart } from './start-blocked-setup-offers';
import { runFrameNow } from './use-frame-action';

export type { BlockedStartRepair } from './start-blocked-repair';

export const FRAME_OFFER_PROMPT =
  'Start needs a completed Frame for this exact job first.\n\n' +
  'OK: trace the job outline now (beam off; a CNC bit lifts to safe Z first). ' +
  'Watch that the trace lands where you expect, then press Start again.\n' +
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

export async function offerFixForBlockedStart(
  messages: ReadonlyArray<string>,
): Promise<BlockedStartRepair> {
  // An active alarm is the one condition that legitimately refuses with two
  // messages at once (alarm state + not-Idle), so it gets an every-message
  // match instead of the sole-blocker rule.
  if (isAlarmOnlyRefusal(messages)) return offerAlarmRecovery();
  const sole = messages.length === 1 ? messages[0] : undefined;
  if (sole === undefined) return 'unrepaired';
  if (sole === frameVerificationBlockedMessage()) return offerFrameRun();
  // Compile-input gates (missing/misplaced origins) offer their own
  // one-click remedies from the sibling module.
  return offerSetupFixForBlockedStart(sole);
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
