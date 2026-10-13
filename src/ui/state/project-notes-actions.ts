import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type ProjectNotesActions = {
  /** `showOnOpen` keeps the current choice when omitted. */
  readonly setProjectNotes: (notes: string, showOnOpen?: boolean) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function projectNotesActions(set: Setter): ProjectNotesActions {
  return {
    setProjectNotes: (notes, showOnOpen) =>
      set((state) => {
        const show = showOnOpen ?? state.project.showNotesOnOpen === true;
        if (state.project.notes === notes && (state.project.showNotesOnOpen === true) === show) {
          return state;
        }
        const { showNotesOnOpen: _previous, ...project } = state.project;
        return {
          project: { ...project, notes, ...(show ? { showNotesOnOpen: true } : {}) },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}
