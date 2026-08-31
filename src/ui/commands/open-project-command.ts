import type { PlatformAdapter } from '../../platform/types';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { handleOpenProject } from '../app/file-actions';
import { useStore } from '../state';
import type { ToastVariant } from '../state/toast-store';

type PushToast = (message: string, variant?: ToastVariant) => void;

export async function openProjectCommand(
  platform: PlatformAdapter,
  pushToast: PushToast,
): Promise<void> {
  if (!(await confirmDiscardAsync(platform, 'open another project'))) return;
  const state = useStore.getState();
  await handleOpenProject({
    platform,
    setProject: state.setProject,
    markLoaded: state.markLoaded,
    pushToast,
    claimProjectOpenRequest: state.claimProjectOpenRequest,
    getProjectOpenRequestEpoch: () => useStore.getState().projectOpenRequestEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
  });
}
