import type { PlatformAdapter } from '../../platform/types';
import { confirmDiscardAsync } from '../app/confirm-discard';
import { handleOpenProject } from '../app/file-actions';
import type { OpenProjectFile } from '../app/project-open-parser';
import { useStore } from '../state';
import type { ToastVariant } from '../state/toast-store';

type PushToast = (message: string, variant?: ToastVariant) => void;

export type OpenProjectOptions = {
  /** A file the operator already chose (Recent Projects, or one the operating
   * system handed over), so the picker is skipped. */
  readonly file?: OpenProjectFile;
  /** Asked once the unsaved-changes guard has answered, which can take as long
   * as the operator leaves its dialog open; false leaves the project alone. */
  readonly stillAllowed?: () => boolean;
};

/** File > Open behind the unsaved-changes guard. */
export async function openProjectCommand(
  platform: PlatformAdapter,
  pushToast: PushToast,
  options: OpenProjectOptions = {},
): Promise<void> {
  if (!(await confirmDiscardAsync(platform, 'open another project'))) return;
  if (options.stillAllowed !== undefined && !options.stillAllowed()) return;
  const state = useStore.getState();
  await handleOpenProject(
    {
      platform,
      setProject: state.setProject,
      markLoaded: state.markLoaded,
      pushToast,
      claimProjectOpenRequest: state.claimProjectOpenRequest,
      getProjectOpenRequestEpoch: () => useStore.getState().projectOpenRequestEpoch,
      getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    },
    options.file,
  );
}
