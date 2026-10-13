import { normalizeProjectStartPoints, type ProjectStartPoints } from '../../core/scene';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type ProjectStartPointActions = {
  readonly setProjectStartPoints: (value: ProjectStartPoints) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function projectStartPointActions(set: Setter): ProjectStartPointActions {
  return {
    setProjectStartPoints: (value) =>
      set((state) => {
        const startPoints = normalizeProjectStartPoints(value);
        if (JSON.stringify(state.project.startPoints) === JSON.stringify(startPoints)) return state;
        const { startPoints: previous, ...project } = state.project;
        void previous;
        return {
          project: startPoints === undefined ? project : { ...project, startPoints },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}
