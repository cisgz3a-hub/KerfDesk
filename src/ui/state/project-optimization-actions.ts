import type { Project, ProjectOptimizationSettings } from '../../core/scene';
import { pushUndo, type StateSlice } from './scene-mutations';

type ProjectOptimizationState = StateSlice & {
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: boolean;
};

type ProjectOptimizationMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type ProjectOptimizationSet = (
  fn: (state: ProjectOptimizationState) => ProjectOptimizationMutation,
) => void;

export type ProjectOptimizationActions = {
  readonly setProjectOptimization: (patch: Partial<ProjectOptimizationSettings>) => void;
};

export function projectOptimizationActions(
  set: ProjectOptimizationSet,
): ProjectOptimizationActions {
  return {
    setProjectOptimization: (patch) =>
      set((state) => ({
        project: {
          ...state.project,
          optimization: { ...state.project.optimization, ...patch },
        },
        undoStack: pushUndo(state.project, state.undoStack),
        redoStack: [],
        dirty: true,
      })),
  };
}
