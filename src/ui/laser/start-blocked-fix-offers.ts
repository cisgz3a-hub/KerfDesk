// Blocked-Start fix offers (maintainer, 2026-07-17: blocks must ask to fix in
// place, not dead-end in an alert). Each offer fires only when its gate is the
// SOLE refusal message — repairing one blocker cannot unblock a Start that
// other gates would still refuse, so mixed refusals keep the plain report.

import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE } from '../state/work-z-zero-evidence';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
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

export async function offerFixForBlockedStart(
  messages: ReadonlyArray<string>,
): Promise<BlockedStartRepair> {
  if (await offerZeroZForBlockedStart(messages)) return 'retry';
  if (messages.length !== 1) return 'unrepaired';
  if (messages[0] === PROBE_PLATE_REMOVAL_REQUIRED_MESSAGE) return offerProbePlateConfirm();
  if (messages[0] === frameVerificationBlockedMessage()) return offerFrameRun();
  return 'unrepaired';
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
