import type { Project, Transform } from '../../core/scene';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';

export type SelectionTransformEdit = {
  readonly id: string;
  readonly transform: Transform;
};

export type SelectionTransformActions = {
  readonly applySelectionTransforms: (edits: ReadonlyArray<SelectionTransformEdit>) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function selectionTransformActions(set: Setter): SelectionTransformActions {
  return {
    applySelectionTransforms: (edits) =>
      set((state) => applySelectionTransformsToState(state, edits)),
  };
}

function applySelectionTransformsToState(
  state: AppState,
  edits: ReadonlyArray<SelectionTransformEdit>,
): AppState | Partial<AppState> {
  if (edits.length === 0) return state;
  const byId = new Map(edits.map((edit) => [edit.id, edit.transform]));
  let changed = false;
  const nextProject: Project = {
    ...state.project,
    scene: {
      ...state.project.scene,
      objects: state.project.scene.objects.map((object) => {
        const transform = byId.get(object.id);
        if (transform === undefined) return object;
        changed = true;
        return { ...object, transform };
      }),
    },
  };
  if (!changed) return state;
  return {
    project: nextProject,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
