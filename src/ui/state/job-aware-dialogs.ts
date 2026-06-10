// Job-aware wrappers for the native blocking dialogs (H13,
// AUDIT-2026-06-10). window.alert / confirm / prompt suspend the renderer
// event loop: Pause/Stop become unclickable, the status poll stops, and the
// ack-driven sends stall — GRBL drains its buffers in under a second at cut
// feed and halts motion with M3 holding the beam at cut power on a
// stationary head until the dialog is dismissed. PROJECT.md non-negotiable
// #9: no modal can block the Stop button.
//
// While a job is active these degrade to non-blocking toasts; confirm and
// prompt fail CLOSED (no, null) so no destructive action proceeds from a
// question the operator never saw. When no job is active the native dialogs
// behave exactly as before.

import { isActiveJob } from './laser-store-helpers';
import { useLaserStore } from './laser-store';
import { useToastStore } from './toast-store';

export const JOB_ACTIVE_CONFIRM_BLOCKED =
  'A job is running — stop it before discarding or replacing work.';

function jobActive(): boolean {
  return isActiveJob(useLaserStore.getState().streamer);
}

export function jobAwareAlert(message: string): void {
  if (jobActive()) {
    useToastStore.getState().pushToast(message, 'warning');
    return;
  }
  window.alert(message);
}

export function jobAwareConfirm(message: string): boolean {
  if (jobActive()) {
    useToastStore.getState().pushToast(JOB_ACTIVE_CONFIRM_BLOCKED, 'warning');
    return false;
  }
  return window.confirm(message);
}

export function jobAwarePrompt(message: string): string | null {
  if (jobActive()) {
    useToastStore.getState().pushToast(JOB_ACTIVE_CONFIRM_BLOCKED, 'warning');
    return null;
  }
  return window.prompt(message);
}
