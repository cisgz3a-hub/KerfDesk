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
          optimization: {
            ...state.project.optimization,
            ...synchronizeTravelPolicy(patch),
          },
        },
        undoStack: pushUndo(state.project, state.undoStack),
        redoStack: [],
        dirty: true,
      })),
  };
}

function synchronizeTravelPolicy(
  patch: Partial<ProjectOptimizationSettings>,
): Partial<ProjectOptimizationSettings> {
  if (patch.travelPolicy !== undefined) {
    return { ...patch, reduceTravelMoves: patch.travelPolicy === 'nearest-neighbor' };
  }
  if (patch.reduceTravelMoves !== undefined) {
    return {
      ...patch,
      travelPolicy: patch.reduceTravelMoves ? 'nearest-neighbor' : 'source-order',
    };
  }
  return patch;
}
