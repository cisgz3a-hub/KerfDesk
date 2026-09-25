import type { PlatformAdapter } from '../../platform/types';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { openProjectTemplate, saveProjectTemplate } from '../app/project-template-actions';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { useStore } from '../state/store';
import type { ToastVariant } from '../state/toast-store';

type PushToast = (message: string, variant?: ToastVariant) => void;

export async function openTemplateCommand(
  platform: PlatformAdapter,
  pushToast: PushToast,
): Promise<void> {
  const epoch = useStore.getState().projectDocumentEpoch;
  if (
    !(await confirmDiscardAsync(platform, 'start from a template')) ||
    useStore.getState().projectDocumentEpoch !== epoch
  )
    return;
  const state = useStore.getState();
  await openProjectTemplate({
    platform,
    setProject: state.setProject,
    markLoaded: state.markLoaded,
    pushToast,
    claimProjectOpenRequest: state.claimProjectOpenRequest,
    getProjectOpenRequestEpoch: () => useStore.getState().projectOpenRequestEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    getProject: () => useStore.getState().project,
  });
}

export async function saveTemplateCommand(
  platform: PlatformAdapter,
  pushToast: PushToast,
): Promise<void> {
  const state = useStore.getState();
  await saveProjectTemplate({
    platform,
    project: projectWithCurrentJobSetup(state),
    savedName: state.savedName,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    pushToast,
  });
}
