// Compile-input fix offers for blocked Starts (maintainer, 2026-07-17,
// frame-first). The only setup refusals left are placement inputs the job
// literally cannot compile without — a User Origin that was never set, or an
// Absolute start with a stale custom origin still active. Both offer their
// one-click remedy in place. Each offer fires only when its gate is the SOLE
// refusal message — the dispatcher in start-blocked-fix-offers enforces that
// before delegating here.

import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  ABSOLUTE_CUSTOM_ORIGIN_ACTIVE_MESSAGE,
  USER_ORIGIN_REQUIRED_MESSAGE,
} from '../job-placement';
import { repairFailed, type BlockedStartRepair } from './start-blocked-repair';

export const SET_ORIGIN_OFFER_PROMPT =
  'User Origin needs a custom work origin.\n\n' +
  'OK: set the work origin at the current head position — the job runs from here — and ' +
  'then Frame the updated placement before starting.\n' +
  'Cancel: leave the job blocked.';

export const RESET_ORIGIN_OFFER_PROMPT =
  'Absolute Coordinates requires the custom work origin to be cleared.\n\n' +
  'OK: reset the work origin to machine coordinates, then Frame before starting.\n' +
  'Cancel: leave the job blocked.';

export async function offerSetupFixForBlockedStart(message: string): Promise<BlockedStartRepair> {
  if (message === USER_ORIGIN_REQUIRED_MESSAGE) return offerSetOriginHere();
  if (message === ABSOLUTE_CUSTOM_ORIGIN_ACTIVE_MESSAGE) return offerResetOrigin();
  return 'unrepaired';
}

async function offerSetOriginHere(): Promise<BlockedStartRepair> {
  if (!jobAwareConfirm(SET_ORIGIN_OFFER_PROMPT)) return 'unrepaired';
  try {
    // The store action itself waits for the post-G92 WCO status frame on
    // WCS-reporting controllers, so a plain retry already sees the origin.
    await useLaserStore.getState().setOriginHere();
  } catch (cause) {
    return repairFailed('Set origin failed', cause);
  }
  useToastStore.getState().pushToast('Work origin set at the current position.', 'success');
  return 'retry';
}

async function offerResetOrigin(): Promise<BlockedStartRepair> {
  if (!jobAwareConfirm(RESET_ORIGIN_OFFER_PROMPT)) return 'unrepaired';
  try {
    await useLaserStore.getState().resetOrigin();
  } catch (cause) {
    return repairFailed('Reset origin failed', cause);
  }
  useToastStore.getState().pushToast('Work origin cleared.', 'success');
  return 'retry';
}
