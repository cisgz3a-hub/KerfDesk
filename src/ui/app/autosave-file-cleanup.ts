import { projectAutosaveService, type AutosaveDurableClearResult } from '../state/autosave-durable';
import type { ToastVariant } from '../state/toast-store';

export const AUTOSAVE_FILE_CLEANUP_WARNING =
  'The project handoff succeeded, but an older recovery snapshot could not be cleared and may appear again.';

type PushToast = (message: string, variant?: ToastVariant) => void;
type AutosaveClearService = {
  clearCurrent(): Promise<AutosaveDurableClearResult>;
};

export function clearAutosaveAfterFileHandoff(
  pushToast: PushToast,
  service: AutosaveClearService = projectAutosaveService,
): void {
  void Promise.resolve()
    .then(() => service.clearCurrent())
    .then(
      (result) => {
        if (result.kind !== 'ok') pushToast(AUTOSAVE_FILE_CLEANUP_WARNING, 'warning');
      },
      () => pushToast(AUTOSAVE_FILE_CLEANUP_WARNING, 'warning'),
    );
}
