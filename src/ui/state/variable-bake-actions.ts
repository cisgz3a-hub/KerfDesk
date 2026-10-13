// Bake Variable Text (LightBurn Variable Text "Bake"): commit already evaluated
// copies of variable text and barcodes as plain artwork in one undo step. The
// evaluation itself is async (fonts render outside the store), so the commit
// refuses when the project changed while it ran instead of overwriting newer
// edits with stale geometry.

import type { Project, SceneObject } from '../../core/scene';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type VariableBakeActions = {
  /** False when `expected` is no longer the current project; nothing changes then. */
  readonly commitBakedVariableObjects: (
    expected: Project,
    baked: ReadonlyArray<SceneObject>,
  ) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function variableBakeActions(set: Setter): VariableBakeActions {
  return {
    commitBakedVariableObjects: (expected, baked) => {
      let committed = false;
      set((state) => {
        if (state.project !== expected || baked.length === 0) return state;
        const byId = new Map(baked.map((object) => [object.id, object]));
        committed = true;
        return {
          project: {
            ...state.project,
            scene: {
              ...state.project.scene,
              objects: state.project.scene.objects.map((object) => byId.get(object.id) ?? object),
            },
          },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      });
      return committed;
    },
  };
}
