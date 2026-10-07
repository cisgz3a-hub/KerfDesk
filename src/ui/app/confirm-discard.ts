// confirmDiscardAsync — the dirty-project guard in front of destructive
// actions (New / Open / test-grid generation), LU18 (AUDIT-2026-06-10) /
// WORKFLOW F-A13. Replaces the two-button window.confirm with LightBurn's
// three-way Save / Don't Save / Cancel dialog: resolves true when the
// caller may proceed (changes saved, or explicitly discarded), false when
// the user cancelled — including cancelling the save picker, which must
// abort the destructive action rather than fall through to a discard.

import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useConfirmSaveStore, type ConfirmSaveChoice } from '../state/confirm-save-store';
import { useToastStore } from '../state/toast-store';
import { handleSaveProject, type SaveProjectOutcome } from './file-actions';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { clearAutosaveForDiscard } from './autosave-file-cleanup';
import { createAutosaveProjectSnapshot } from '../state/autosave-project-snapshot';

export async function confirmDiscardAsync(
  platform: PlatformAdapter,
  action: string,
): Promise<boolean> {
  const state = useStore.getState();
  if (!state.dirty) return true;
  const documentEpoch = state.projectDocumentEpoch;
  const choice = await requestChoice(state.savedName ?? 'this project', action);
  // A pending Open or recovery can replace the document while the question is
  // visible. The choice names the original document, never its replacement.
  if (useStore.getState().projectDocumentEpoch !== documentEpoch) return false;
  if (choice === 'cancel') return false;
  if (choice === 'discard') {
    const discardedProject = useStore.getState().project;
    const getSnapshot = createAutosaveProjectSnapshot();
    const discardedSnapshot = getSnapshot(useStore.getState());
    const isCurrent = (): boolean => getSnapshot(useStore.getState()) === discardedSnapshot;
    await clearAutosaveForDiscard(discardedProject, isCurrent, (message, variant) => {
      if (isCurrent()) useToastStore.getState().pushToast(message, variant);
    });
    return isCurrent();
  }
  const outcome = await saveProjectNow(platform);
  return outcome === 'saved' && useStore.getState().projectDocumentEpoch === documentEpoch;
}

function requestChoice(projectName: string, action: string): Promise<ConfirmSaveChoice> {
  return new Promise((resolve) => {
    useConfirmSaveStore.getState().open({ projectName, action, resolve });
  });
}

// Re-read the store after the dialog resolves: the project must be
// serialized as it exists at Save-click time, not as captured when the
// guard was invoked. Closing the desktop app saves through here too (ADR-549).
export async function saveProjectNow(platform: PlatformAdapter): Promise<SaveProjectOutcome> {
  const state = useStore.getState();
  return handleSaveProject({
    platform,
    project: projectWithCurrentJobSetup(state),
    expectedProject: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    getProjectDocumentEpoch: () => useStore.getState().projectDocumentEpoch,
    claimProjectSaveRequest: state.claimProjectSaveRequest,
    getProjectSaveRequestEpoch: () => useStore.getState().projectSaveRequestEpoch,
    projectSaveWriteCoordinator: state.projectSaveWriteCoordinator,
    savedName: state.savedName,
    lastSaveTarget: state.lastSaveTarget,
    markSaved: state.markSaved,
    markProjectSaveUncertain: state.markProjectSaveUncertain,
    pushToast: useToastStore.getState().pushToast,
  });
}
