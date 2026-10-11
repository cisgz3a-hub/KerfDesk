import type { PlatformAdapter } from '../../platform/types';
import { handleSaveProject } from '../app/project-save-action';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { useToastStore } from '../state/toast-store';
import { RemoteFault } from './fault';
import type { RemoteAppStore } from './types';

type Commit = (action: () => Record<string, unknown>) => Record<string, unknown>;

/** Saves only to the existing target. A never-saved project would open a picker on the PC. */
export async function saveProjectRemotely(
  store: RemoteAppStore,
  platform: PlatformAdapter | null,
  commit: Commit,
): Promise<Record<string, unknown>> {
  const app = store.getState();
  if (app.lastSaveTarget === null)
    return {
      saved: false,
      message:
        'This project has not been saved yet. Save it once on the PC, then it can be saved from here.',
    };
  if (platform === null) throw new RemoteFault('unavailable');
  commit(() => ({}));
  const current = app;
  const outcome = await handleSaveProject(
    {
      platform,
      project: projectWithCurrentJobSetup(current),
      expectedProject: current.project,
      projectDocumentEpoch: current.projectDocumentEpoch,
      getProjectDocumentEpoch: () => store.getState().projectDocumentEpoch,
      claimProjectSaveRequest: current.claimProjectSaveRequest,
      getProjectSaveRequestEpoch: () => store.getState().projectSaveRequestEpoch,
      projectSaveWriteCoordinator: current.projectSaveWriteCoordinator,
      savedName: current.savedName,
      lastSaveTarget: current.lastSaveTarget,
      markSaved: current.markSaved,
      markProjectSaveUncertain: current.markProjectSaveUncertain,
      pushToast: useToastStore.getState().pushToast,
    },
    false,
  );
  if (outcome === 'saved-with-newer-edits')
    return {
      saved: true,
      message: 'Saved the captured version on the PC. Newer edits remain unsaved.',
    };
  return outcome === 'saved'
    ? { saved: true, message: 'Saved on the PC.' }
    : { saved: false, message: 'The save did not finish. Check KerfDesk on the PC.' };
}
