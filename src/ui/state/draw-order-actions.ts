// Change Draw Order (LightBurn Push tools). Restacks the selection on the
// canvas without changing the machine output order (core/draw-order.ts).

import { moveObjectsInDrawOrder, type DrawOrderMove } from '../../core/draw-order';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type DrawOrderActions = {
  readonly moveSelectionInDrawOrder: (move: DrawOrderMove) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function drawOrderActions(set: Setter): DrawOrderActions {
  return {
    moveSelectionInDrawOrder: (move) =>
      set((state) => {
        const ids = new Set(selectedObjectIds(state));
        if (ids.size === 0) return state;
        const scene = moveObjectsInDrawOrder(state.project.scene, ids, move);
        if (scene === state.project.scene) return state;
        return {
          project: { ...state.project, scene },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      }),
  };
}
