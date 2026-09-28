// Whether the Optimize Shapes dialog (LightBurn gap LBG-T22) is open. Session
// chrome, like the Copy Along Path dialog, so it stays out of the project
// store and out of the command-shell callbacks.

import { create } from 'zustand';
import { useStore } from '../state';
import { optimizeShapesSelectionProblem } from '../state/optimize-shapes-notice';
import { optimizeShapesSelection } from '../state/optimize-shapes-plan';
import { selectedObjectIds } from '../state/scene-group-actions';
import { useToastStore } from '../state/toast-store';

type OptimizeShapesDialogState = {
  readonly open: boolean;
  readonly show: () => void;
  readonly close: () => void;
};

export const useOptimizeShapesDialogStore = create<OptimizeShapesDialogState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

/** Open the dialog, or say what the selection is missing and change nothing. */
export function openOptimizeShapesDialog(): void {
  const state = useStore.getState();
  const selection = optimizeShapesSelection(state.project.scene, selectedObjectIds(state));
  const problem = optimizeShapesSelectionProblem(selection);
  if (problem !== null) {
    useToastStore.getState().pushToast(problem, 'warning');
    return;
  }
  useOptimizeShapesDialogStore.getState().show();
}
