// Compile-input fix offers for blocked Starts (maintainer, 2026-07-17,
// frame-first). The only setup refusals left are placement inputs the job
// literally cannot compile without — a User or Verified Origin that was never
// set. Absolute uses the observed offset without erasing it. Each offer
// its one-click remedy in place. Each offer fires only when its gate is the SOLE
// refusal message; Frame job's repair (frame-blocker-repair) enforces that
// before delegating here.

import type { JobOriginAnchor } from '../../core/job';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import {
  DEFAULT_JOB_PLACEMENT,
  USER_ORIGIN_REQUIRED_MESSAGE,
  VERIFIED_ORIGIN_REQUIRED_MESSAGE,
} from '../job-placement';
import { repairFailed, type BlockedStartRepair } from './start-blocked-repair';
import {
  abortRestoreHomesFirst,
  offerRestoreAbortOrigin,
  restartedOriginNote,
  unrestoredAbortOrigin,
} from './unrestored-abort-origin';

// The offer names the point of the design that lands at the head, which a
// beginner otherwise found only as "FL" in the Placement panel (UX audit
// U4-P3-6).
const ANCHOR_WORDS: Readonly<Record<JobOriginAnchor, string>> = {
  'back-left': 'back-left corner',
  'back-center': 'middle of the back edge',
  'back-right': 'back-right corner',
  'center-left': 'middle of the left edge',
  center: 'centre',
  'center-right': 'middle of the right edge',
  'front-left': 'front-left corner',
  'front-center': 'middle of the front edge',
  'front-right': 'front-right corner',
};

export function setOriginOfferPrompt(
  mode: 'User Origin' | 'Verified Origin',
  anchor: JobOriginAnchor,
  note?: string,
): string {
  return (
    `${mode} needs a custom work origin.${note === undefined ? '' : ` ${note}`}\n\n` +
    `OK: set the work origin where the head is now. The ${ANCHOR_WORDS[anchor]} of your design ` +
    'goes there and the job runs from it. Then Frame the updated placement before starting.\n' +
    'Cancel: leave the job blocked.'
  );
}

export const SET_ORIGIN_OFFER_PROMPT = setOriginOfferPrompt(
  'User Origin',
  DEFAULT_JOB_PLACEMENT.anchor,
);

export const VERIFIED_ORIGIN_SET_ORIGIN_OFFER_PROMPT = setOriginOfferPrompt(
  'Verified Origin',
  DEFAULT_JOB_PLACEMENT.anchor,
);

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
  // Once machine zero may have moved, only Home makes it trustworthy (X1-P1-1).
  const abort = unrestoredAbortOrigin(useLaserStore.getState());
  if (abort !== null && (!abort.machineZeroMoved || abortRestoreHomesFirst())) {
    return offerRestoreAbortOrigin(placement, abort);
  }
  const note = abort === null ? undefined : restartedOriginNote(abort.saved);
  return offerSetOriginHere(
    setOriginOfferPrompt(placement, useStore.getState().jobPlacement.anchor, note),
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
