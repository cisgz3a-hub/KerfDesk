import type { LastCompletedReceipt, RecoveryRepository } from '../state/recovery';
import { useToastStore } from '../state/toast-store';
import { reportStartBlockers } from './start-blocker-invalidation';
import type { StartAuthorizationRefusal } from './start-job-authorization';

export function startAuthorizationRefusalMessage(refusal: StartAuthorizationRefusal): string {
  switch (refusal.kind) {
    case 'completed-receipt-changed':
      return 'The completed-job replay offer changed before streaming began.';
    case 'execution-inputs-changed':
      return 'The prepared job inputs changed before streaming began.';
    case 'blocked':
      return refusal.message;
  }
}

export async function reportStartAuthorizationRefusal(
  refusal: StartAuthorizationRefusal,
  receipt: LastCompletedReceipt | null,
  repository: RecoveryRepository,
): Promise<void> {
  switch (refusal.kind) {
    case 'completed-receipt-changed':
      useToastStore
        .getState()
        .pushToast(
          'The completed-job replay offer changed. Review the current job controls.',
          'warning',
        );
      return;
    case 'execution-inputs-changed':
      await reportChangedExecutionInputs(receipt, repository);
      return;
    case 'blocked':
      reportBlockedStart(refusal.message);
  }
}

function reportBlockedStart(message: string): void {
  reportRefusedStart('Cannot start job', message);
}

const START_REFUSED_TOAST_KEY = 'start-refused';

/**
 * A Start that was refused is said where Frame says its refusals: the banner
 * keeps the reason until it is answered, and one toast points to it. It used to
 * add a native alert on top of the banner (annoyance audit A1-P3-3, ADR-707).
 * A second refusal rewrites the same toast instead of stacking.
 */
export function reportRefusedStart(lead: string, message: string): void {
  reportStartBlockers([message]);
  useToastStore
    .getState()
    .pushToast(`${lead}: ${message}`, 'error', { key: START_REFUSED_TOAST_KEY });
}

async function reportChangedExecutionInputs(
  receipt: LastCompletedReceipt | null,
  repository: RecoveryRepository,
): Promise<void> {
  if (receipt !== null) {
    await repository.discardCompletedReceipt(receipt.runId);
    useToastStore
      .getState()
      .pushToast('The completed job changed. Use Start job to run the current canvas.', 'warning');
    return;
  }
  reportBlockedStart(
    'The current project, output scope, placement, or registration changed while Start was being prepared. Review the current job and press Start again.',
  );
}
