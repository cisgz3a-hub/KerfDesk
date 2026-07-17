// A Start refused ONLY for the missing work-Z zero used to dead-end in an
// alert, leaving the operator to hunt down the fix themselves (maintainer,
// 2026-07-17: "the software should ask to set zero not silently kill the
// job"). Offer the fix in place instead: confirm the bit is on the stock
// top, Zero Z through the normal store action, and let the Start flow retry.

import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { CNC_NO_WORK_ZERO_START_MESSAGE } from './cnc-start-advisories';

/** One in-place fix offer per Start click: the retried flow must not re-ask,
 * or a still-failing gate would loop the operator through the same dialog. */
export type StartOfferPolicy = 'offer-fixes' | 'no-offers';

export const ZERO_Z_OFFER_PROMPT =
  'No work Z zero is set — the CNC toolpath assumes Z0 is the stock top.\n\n' +
  'Is the bit touching the stock top right now?\n\n' +
  'OK: zero Z at the current position and continue this Start.\n' +
  'Cancel: leave the job blocked — jog the bit down onto the stock top ' +
  '(or run a touch-plate probe), then Start again.';

/** True when the refusal was exactly the missing-work-zero gate, the operator
 * accepted the offer, and Zero Z succeeded — the caller retries the Start. */
export async function offerZeroZForBlockedStart(messages: ReadonlyArray<string>): Promise<boolean> {
  // Only when Z zero is the sole blocker: zeroing cannot unblock a Start that
  // other gates would still refuse, so those keep the plain refusal report.
  if (messages.length !== 1 || messages[0] !== CNC_NO_WORK_ZERO_START_MESSAGE) return false;
  if (!jobAwareConfirm(ZERO_Z_OFFER_PROMPT)) return false;
  try {
    await useLaserStore.getState().zeroZHere();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    useToastStore.getState().pushToast(`Zero Z failed: ${reason}`, 'warning');
    return false;
  }
  useToastStore.getState().pushToast('Work Z zeroed at the current position.', 'success');
  return true;
}
