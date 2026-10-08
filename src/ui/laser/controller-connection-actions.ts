import { useLaserStore } from '../state/laser-store';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useToastStore } from '../state/toast-store';
import { clearStartBlockers } from './start-blocker-invalidation';

export function confirmForgetController(): void {
  if (
    !jobAwareConfirm(
      'Forget this controller, remove its browser serial permission, and clear all controller and recovery state? Your canvas and machine profile will stay open.',
    )
  ) {
    return;
  }
  void forgetControllerAndClearStartBlockers();
}

export async function forgetControllerAndClearStartBlockers(): Promise<void> {
  try {
    await useLaserStore.getState().forgetDevice?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useToastStore.getState().pushToast(`Forget Controller could not finish: ${message}`, 'error');
  } finally {
    clearStartBlockers();
  }
}
