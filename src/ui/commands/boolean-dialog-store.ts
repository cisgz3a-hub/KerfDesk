import { create } from 'zustand';
import type { Project } from '../../core/scene';
import type { VectorBooleanOp } from '../../core/geometry';
import { useStore } from '../state';
import { selectedObjectIds } from '../state/scene-group-actions';

export type BooleanPreviewOperation = VectorBooleanOp | 'weld';
export type BooleanSession = {
  readonly project: Project;
  readonly ids: ReadonlyArray<string>;
  readonly documentEpoch: number;
  readonly operation: BooleanPreviewOperation;
};
export const useBooleanDialogStore = create<{
  readonly session: BooleanSession | null;
  readonly show: (operation: BooleanPreviewOperation) => void;
  readonly close: () => void;
}>((set) => ({
  session: null,
  show: (operation) => {
    const state = useStore.getState();
    set({
      session: {
        project: state.project,
        ids: selectedObjectIds(state),
        documentEpoch: state.projectDocumentEpoch,
        operation,
      },
    });
  },
  close: () => set({ session: null }),
}));
export function openBooleanDialog(operation: BooleanPreviewOperation): void {
  useBooleanDialogStore.getState().show(operation);
}
