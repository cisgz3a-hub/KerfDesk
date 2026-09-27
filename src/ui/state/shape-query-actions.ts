// Select Contained and Select Smaller Shapes (LightBurn gap batch 5, LBG-F03,
// ADR-480). Like Select Open Shapes they only pick artwork the user could
// click, keep the current selection, and say what they found.

import {
  containedObjectIds,
  smallerObjectIds,
  worldClosedContours,
} from '../../core/geometry/shape-containment';
import type { SceneObject } from '../../core/scene';
import { selectedObjectIds } from './scene-group-actions';
import { pickableObjects, selectIds } from './selection-query-actions';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type ShapeQueryActions = {
  /** Add every pickable object lying fully inside a selected closed shape. */
  readonly selectContainedShapes: () => void;
  /** Add every pickable object no wider and no taller than the selected artwork. */
  readonly selectSmallerShapes: () => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function shapeQueryActions(set: Setter): ShapeQueryActions {
  return {
    selectContainedShapes: () =>
      set((state) => {
        const { selected, others } = splitSelection(state);
        const contours = worldClosedContours(selected);
        if (contours.length === 0) {
          toast('Select a closed shape first. Select Contained adds the artwork inside it.');
          return state;
        }
        const found = containedObjectIds(contours, others);
        toast(
          found.length === 0
            ? 'Nothing lies fully inside the selected shape.'
            : `Added ${countLabel(found.length)} lying inside the selected shape.`,
        );
        return found.length === 0 ? state : addToSelection(state, selected, found);
      }),
    selectSmallerShapes: () =>
      set((state) => {
        const { selected, others } = splitSelection(state);
        if (selected.length === 0) {
          toast('Select a shape first. Select Smaller Shapes adds artwork no bigger than it.');
          return state;
        }
        const found = smallerObjectIds(selected, others);
        toast(
          found.length === 0
            ? 'No other artwork is as small as the selection.'
            : `Added ${countLabel(found.length)} no wider and no taller than the selection.`,
        );
        return found.length === 0 ? state : addToSelection(state, selected, found);
      }),
  };
}

function splitSelection(state: AppState): {
  readonly selected: ReadonlyArray<SceneObject>;
  readonly others: ReadonlyArray<SceneObject>;
} {
  const ids = new Set(selectedObjectIds(state));
  const selected = state.project.scene.objects.filter((object) => ids.has(object.id));
  const others = pickableObjects(state.project.scene).filter((object) => !ids.has(object.id));
  return { selected, others };
}

function addToSelection(
  state: AppState,
  selected: ReadonlyArray<SceneObject>,
  found: ReadonlyArray<string>,
): Partial<AppState> {
  return selectIds(state, [...selected.map((object) => object.id), ...found]);
}

function countLabel(count: number): string {
  return count === 1 ? '1 object' : `${count} objects`;
}

function toast(message: string): void {
  useToastStore.getState().pushToast(message, 'info');
}
