// reportControllerActionFailure — the one place a refused or failed controller
// action becomes visible.
//
// The store refuses controller actions it cannot perform (a write still owed
// its acknowledgement, a state that does not allow the action, a transport
// that rejected the line) and records the reason in lastWriteError and the
// console log. Nothing in the rail renders either, and every rail control
// dropped the rejection with `.catch(() => undefined)`, so a refused Jog, Home,
// Unlock, Wake, override or air click looked like nothing happened (controller
// audit 2026-09-23, ui-panel-1 / regressions-3). Deliberate cancellations stay
// quiet: releasing a held jog or retiring an origin transaction is not a
// failure.

import { OriginTransactionCancelledError } from '../state/laser-origin-transaction';
import { MANUAL_MOTION_CANCELLED_MESSAGE } from '../state/manual-motion-intent';
import { useToastStore } from '../state/toast-store';

const DELIBERATE_CANCELLATION_MESSAGES: ReadonlyArray<string | RegExp> = [
  MANUAL_MOTION_CANCELLED_MESSAGE,
  /was cancelled or replaced before its first command was dispatched\.$/,
  'Motion cancellation was replaced before its confirmation completed.',
];

export function isDeliberateCancellation(error: unknown): boolean {
  if (error instanceof OriginTransactionCancelledError) return true;
  if (!(error instanceof Error)) return false;
  return DELIBERATE_CANCELLATION_MESSAGES.some((pattern) =>
    typeof pattern === 'string' ? error.message === pattern : pattern.test(error.message),
  );
}

/** Toasts `<action>: <reason>`. A held key or a double click that meets the
 * same refusal again does not stack a second copy while the first is shown. */
export function reportControllerActionFailure(action: string, error: unknown): void {
  if (isDeliberateCancellation(error)) return;
  const reason = error instanceof Error ? error.message : String(error);
  const message = `${action}: ${reason}`;
  const toasts = useToastStore.getState();
  if (toasts.toasts.some((toast) => toast.message === message)) return;
  toasts.pushToast(message, 'error');
}

/** `.catch` handler for a controller action started from a click or key. */
export function controllerActionFailureHandler(action: string): (error: unknown) => void {
  return (error) => reportControllerActionFailure(action, error);
}
