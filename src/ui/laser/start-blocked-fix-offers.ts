// Blocked-Start fix offers (maintainer, 2026-07-17: frame-first — Frame is
// the ONLY Start guard; blocks must ask to fix in place, not dead-end in an
// alert). Under frame-first the refusals that remain are transport state
// (alarm — offered by start-blocked-alarm-offers), compile inputs (origins —
// offered by start-blocked-setup-offers), and the Frame gate itself, whose
// offer runs the trace right here. Each offer fires only when its gate is the
// SOLE refusal message — repairing one blocker cannot unblock a Start that
// other gates would still refuse. The ordinary Frame reaches the alarm and
// origin offers through frame-blocker-repair instead of this dispatcher.

import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useToastStore } from '../state/toast-store';
import { frameVerificationBlockedMessage } from './frame-verification-policy';
import { type BlockedStartRepair } from './start-blocked-repair';
import { offerAlarmFixForBlockedStart } from './start-blocked-alarm-offers';
import { offerSetupFixForBlockedStart } from './start-blocked-setup-offers';
import { runFrameNow } from './use-frame-action';

export type { BlockedStartRepair } from './start-blocked-repair';

export const FRAME_OFFER_PROMPT =
  'Start needs a completed Frame for this exact job first.\n\n' +
  'OK: trace the job outline now (beam off; a CNC bit lifts to safe Z first). ' +
  'Watch that the trace lands where you expect, then press Start again.\n' +
  'Cancel: leave the job blocked.';

export { HOME_OFFER_PROMPT, UNLOCK_OFFER_PROMPT } from './start-blocked-alarm-offers';

export async function offerFixForBlockedStart(
  messages: ReadonlyArray<string>,
): Promise<BlockedStartRepair> {
  // An active alarm is the one condition that legitimately refuses with two
  // messages at once (alarm state + not-Idle), so its offer matches every
  // message instead of applying the sole-blocker rule.
  const alarmRepair = await offerAlarmFixForBlockedStart(messages);
  if (alarmRepair !== 'unrepaired') return alarmRepair;
  const sole = messages.length === 1 ? messages[0] : undefined;
  if (sole === undefined) return 'unrepaired';
  if (sole === frameVerificationBlockedMessage()) return offerFrameRun();
  // Compile-input gates (missing/misplaced origins) offer their own
  // one-click remedies from the sibling module.
  return offerSetupFixForBlockedStart(sole);
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
