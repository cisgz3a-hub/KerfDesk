// Compile-input fix offers for blocked Starts (maintainer, 2026-07-17,
// frame-first). The only setup refusals left are placement inputs the job
// literally cannot compile without — a User or Verified Origin that was never
// set. Absolute uses the observed offset without erasing it. Each offer
// its one-click remedy in place. Each offer fires only when its gate is the SOLE
// refusal message; Frame job's repair (frame-blocker-repair) enforces that
// before delegating here.

import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { USER_ORIGIN_REQUIRED_MESSAGE, VERIFIED_ORIGIN_REQUIRED_MESSAGE } from '../job-placement';
import { repairFailed, type BlockedStartRepair } from './start-blocked-repair';
import { offerRestoreAbortOrigin, unrestoredAbortOrigin } from './unrestored-abort-origin';

const SET_ORIGIN_OFFER_BODY =
  'OK: set the work origin at the current head position — the job runs from here — and ' +
  'then Frame the updated placement before starting.\n' +
  'Cancel: leave the job blocked.';

export const SET_ORIGIN_OFFER_PROMPT =
  'User Origin needs a custom work origin.\n\n' + SET_ORIGIN_OFFER_BODY;

export const VERIFIED_ORIGIN_SET_ORIGIN_OFFER_PROMPT =
  'Verified Origin needs a custom work origin.\n\n' + SET_ORIGIN_OFFER_BODY;

export async function offerSetupFixForBlockedStart(message: string): Promise<BlockedStartRepair> {
  const placement =
    message === USER_ORIGIN_REQUIRED_MESSAGE
      ? 'User Origin'
      : message === VERIFIED_ORIGIN_REQUIRED_MESSAGE
        ? 'Verified Origin'
        : null;
  if (placement === null) return 'unrepaired';
  // An aborted job's origin that was not put back comes first: setting the
  // origin at the head would re-run the job off the half-burned piece (V3-P2-2).
  const saved = unrestoredAbortOrigin(useLaserStore.getState());
  if (saved !== null) return offerRestoreAbortOrigin(placement, saved);
  return offerSetOriginHere(
    placement === 'User Origin' ? SET_ORIGIN_OFFER_PROMPT : VERIFIED_ORIGIN_SET_ORIGIN_OFFER_PROMPT,
  );
}

async function offerSetOriginHere(prompt: string): Promise<BlockedStartRepair> {
  if (!jobAwareConfirm(prompt)) return 'unrepaired';
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
