// Whether the Copy Along Path dialog (LightBurn gap LBG-T09) is open. Session
// chrome, like the barcode dialog, so it stays out of the project store and
// out of the command-shell callbacks.

import { create } from 'zustand';
import { useStore } from '../state';
import { selectedSceneObjects } from '../state/copy-along-path-actions';
import { copyAlongPathSelectionProblem } from '../state/copy-along-path-plan';
import { useToastStore } from '../state/toast-store';

type CopyAlongPathDialogState = {
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
};

export const useCopyAlongPathDialogStore = create<CopyAlongPathDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

/** Open the dialog, or say what the selection is missing and change nothing. */
export function openCopyAlongPathDialog(): void {
  const problem = copyAlongPathSelectionProblem(selectedSceneObjects(useStore.getState()));
  if (problem !== null) {
    useToastStore.getState().pushToast(problem, 'warning');
    return;
  }
  useCopyAlongPathDialogStore.getState().show();
}
