import { projectWithCurrentJobSetup } from '../state/project-job-setup';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { getProjectSaveCheckpoint } from './project-save-checkpoint';

/** Null retains the synchronous clean-project path when no external editor is bound. */
export function checkpointBeforeProjectDecision(): Promise<boolean> | null {
  const checkpoint = getProjectSaveCheckpoint();
  if (checkpoint === null) return null;
  const state = useStore.getState();
  const isCurrent = () => useStore.getState().projectDocumentEpoch === state.projectDocumentEpoch;
  return checkpoint({
    project: projectWithCurrentJobSetup(state),
    expectedProject: state.project,
    projectDocumentEpoch: state.projectDocumentEpoch,
    isCurrent,
  }).then(
    () => isCurrent(),
    (error: unknown) => {
      if (isCurrent())
        useToastStore
          .getState()
          .pushToast(
            `Could not preserve studio edits: ${error instanceof Error ? error.message : String(error)}. The project stays open.`,
            'error',
          );
      return false;
    },
  );
}
