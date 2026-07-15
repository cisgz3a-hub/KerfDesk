import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { LastCompletedReceipt, RecoveryRepository } from '../state/recovery';
import { useToastStore } from '../state/toast-store';
import { useStartBlockerStore } from './start-blocker-store';
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

export function reportBlockedStart(message: string): void {
  useStartBlockerStore.getState().report([message]);
  jobAwareAlert(`Cannot start job:\n\n${message}`);
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
    'The current project, output scope, placement, registration, camera setup, or rotary-raster policy changed while Start was being prepared. Review the current job and press Start again.',
  );
}
