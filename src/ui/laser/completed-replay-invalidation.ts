import type { RecoveryRepository, LastCompletedReceipt } from '../state/recovery';
import { useToastStore } from '../state/toast-store';
import { COMPLETED_REPLAY_CHANGED_MESSAGE } from './start-job-execution-tracking';

export async function discardChangedCompletedReplay(
  receipt: LastCompletedReceipt,
  repository: RecoveryRepository,
): Promise<void> {
  await repository.discardCompletedReceipt(receipt.runId);
  useToastStore.getState().pushToast(COMPLETED_REPLAY_CHANGED_MESSAGE, 'warning');
}

export function completedReplayInvalidationHandler(
  receipt: LastCompletedReceipt | null,
  repository: RecoveryRepository,
): { readonly onCompletedReplayChanged?: () => Promise<void> } {
  return receipt === null
    ? {}
    : { onCompletedReplayChanged: () => discardChangedCompletedReplay(receipt, repository) };
}
