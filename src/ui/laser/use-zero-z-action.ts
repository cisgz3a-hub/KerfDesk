// use-zero-z-action — the jog pad's Zero Z click handler. Runs the
// zero-z-guard confirmation against the live store state before writing
// G92 Z0: the guard is what stops a parked-height click (post-probe
// retract, post-frame safe-Z) from silently moving work Z0 into the air.
//
// The question is asked in the app (ADR-707), not in a native box. A native
// confirm is refused for the whole of a job, a bit-change hold included, so a
// second Zero Z at a hold (the first was taken too early, or with another bit
// declared) was dropped with "A job is running — stop it before discarding or
// replacing work." and the hold could not be finished (ADR-416 Amendment 4).
// It is not refused during a job here: the store's own gate decides when
// Zero Z may be sent, and allows it only in a settled hold.

import { useCallback } from 'react';
import { appConfirm } from '../state/app-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { controllerActionFailureHandler } from './report-controller-action-failure';
import { liveZeroZOverwriteWarning } from './zero-z-guard';

export const ZERO_Z_OVERWRITE_TITLE = 'Replace the work Z zero?';
export const ZERO_Z_OVERWRITE_BUTTON = 'Zero Z here';
export const ZERO_Z_CHANGED_WHILE_ASKED_MESSAGE =
  'The bit or the controller moved while the question was open, so work Z was not changed. Press Zero Z again.';

export function useZeroZAction(): () => void {
  // The live state is read at the click. Subscribing to it re-rendered the
  // whole jog panel on every status poll of a running job, only to hold values
  // this handler reads once (ADR-352).
  return useCallback((): void => {
    void zeroZWithOverwriteQuestion().catch(controllerActionFailureHandler('Zero Z'));
  }, []);
}

async function zeroZWithOverwriteQuestion(): Promise<void> {
  if (!(await overwriteAccepted())) return;
  // Both outcomes are visible: the DRO does not show work Z, and a refusal
  // used to become an unhandled rejection with no message (audit ui-panel-5).
  await useLaserStore.getState().zeroZHere();
  useToastStore.getState().pushToast('Work Z0 set at the current bit height (G92 Z0).', 'success');
}

/** True when Zero Z may be written: nothing is overwritten, or the operator
 * said yes to the question as it still stands. The page keeps running while
 * the question is open, so a yes counts only if the answer it would give now
 * is the one that was asked (ADR-707 decision 6). */
async function overwriteAccepted(): Promise<boolean> {
  const asked = useLaserStore.getState();
  const warning = liveZeroZOverwriteWarning(asked);
  if (warning === null) return true;
  const accepted = await appConfirm({
    title: ZERO_Z_OVERWRITE_TITLE,
    message: warning,
    confirmLabel: ZERO_Z_OVERWRITE_BUTTON,
    // The yes sends a command: Enter on its way elsewhere must not press it.
    initialFocus: 'surface',
  });
  if (!accepted) return false;
  const now = useLaserStore.getState();
  if (
    now.controllerSessionEpoch === asked.controllerSessionEpoch &&
    liveZeroZOverwriteWarning(now) === warning
  ) {
    return true;
  }
  useToastStore.getState().pushToast(ZERO_Z_CHANGED_WHILE_ASKED_MESSAGE, 'warning');
  return false;
}
