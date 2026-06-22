import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type ProjectNotesActions = {
  readonly setProjectNotes: (notes: string) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function projectNotesActions(set: Setter): ProjectNotesActions {
  return {
    setProjectNotes: (notes) =>
      set((state) => {
        if (state.project.notes === notes) return state;
        return {
          project: { ...state.project, notes },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}
