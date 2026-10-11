import { getProjectSaveCheckpoint } from '../app/project-save-checkpoint';
import { useStore } from '../state/store';
import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { useToastStore } from '../state/toast-store';

let pending = false;

/** Archive the native editor's latest bytes before changing the active sheet owner. */
export function runProjectSheetChange(change: () => void): void {
  if (pending) return;
  const checkpoint = getProjectSaveCheckpoint();
  if (checkpoint === null) {
    change();
    return;
  }
  const state = useStore.getState();
  const epoch = state.projectDocumentEpoch;
  const isCurrent = (): boolean => useStore.getState().projectDocumentEpoch === epoch;
  pending = true;
  void checkpoint({
    project: projectWithCurrentJobSetup(state),
    expectedProject: state.project,
    projectDocumentEpoch: epoch,
    isCurrent,
  })
    .then(() => {
      if (isCurrent()) change();
    })
    .catch((error: unknown) => {
      if (isCurrent())
        useToastStore
          .getState()
          .pushToast(
            `The active sheet was kept: ${error instanceof Error ? error.message : String(error)}`,
            'error',
          );
    })
    .finally(() => {
      pending = false;
    });
}
