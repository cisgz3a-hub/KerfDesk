// Alarm fix offer for a blocked Frame or Start (maintainer, 2026-07-17: blocks
// ask to fix in place). A machine that has homing switches is homed, because
// Home re-proves position; one without them can only be unlocked after the
// operator vouches for the head, the same split STATUS_ALARM_START_MESSAGE
// instructs. The prompts name the actions, not GRBL's $H/$X: the active
// driver may home or unlock with other commands (the alarm banner spells
// those out). Split out of start-blocked-fix-offers so the ordinary Frame can
// reach it: that dispatcher also owns the Frame-run offer, which imports
// runFrameNow and would close an import cycle.

import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { repairFailed, settleThenRetry, type BlockedStartRepair } from './start-blocked-repair';
import { STATUS_ALARM_START_MESSAGE } from './start-job-input';
import { ALARM_ACTIVE_START_MESSAGE, machineNotIdleStartMessage } from './start-machine-refusals';

export const UNLOCK_OFFER_PROMPT =
  'The controller is in Alarm.\n\n' +
  'Unlock clears the alarm WITHOUT re-establishing position — only continue if the head ' +
  'is safe where it is. Afterwards, jog the head to where the job should start and click ' +
  '"Set origin here" before framing.\n\n' +
  'OK: unlock now.\n' +
  'Cancel: leave it blocked.';

export const UNLOCKED_NEXT_STEP_MESSAGE =
  'Alarm cleared. Jog the head to where the job should start, click "Set origin here", then ' +
  'Frame again.';

export const HOME_OFFER_PROMPT =
  'The controller is in Alarm.\n\n' +
  'Home runs the homing cycle to re-establish machine position. Make sure the machine ' +
  'is clear before it moves.\n\n' +
  'OK: home now and continue when the cycle finishes.\n' +
  'Cancel: leave it blocked.';

/** Offers Home or Unlock when every refusal message is an alarm message; an
 * alarm legitimately refuses with two at once (alarm state + not Idle). Any
 * other refusal returns 'unrepaired' without asking. */
export async function offerAlarmFixForBlockedStart(
  messages: ReadonlyArray<string>,
): Promise<BlockedStartRepair> {
  if (!isAlarmOnlyRefusal(messages)) return 'unrepaired';
  const homingEnabled = useStore.getState().project.device.homing.enabled;
  return homingEnabled ? offerHomeCycle() : offerUnlock();
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

// Unlock voids the reported position until Home or Set origin re-establishes
// it (controllerUnlockedPatch), so no Frame or Start can continue straight
// from here: hand the operator the one step that can.
async function offerUnlock(): Promise<BlockedStartRepair> {
  if (!useLaserStore.getState().capabilities.unlock) return 'unrepaired';
  if (!jobAwareConfirm(UNLOCK_OFFER_PROMPT)) return 'unrepaired';
  try {
    await useLaserStore.getState().unlockAlarm();
  } catch (cause) {
    return repairFailed('Unlock failed', cause);
  }
  useToastStore.getState().pushToast(UNLOCKED_NEXT_STEP_MESSAGE, 'info');
  return 'handled';
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
    'Homed. Try again once the controller reports Idle.',
  );
}
