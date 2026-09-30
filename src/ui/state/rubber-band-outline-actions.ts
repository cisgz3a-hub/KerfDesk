// Create Rubber-Band Outline (LightBurn gap batch 5, LBG-T07, ADR-480): add
// one closed shape stretched around the selection and select it. The outline
// takes the settings of the first selected Line operation, so it cuts like the
// artwork's own outline; with none, it gets a new Line operation. One undo step.

import { rubberBandOutline } from '../../core/geometry/rubber-band-outline';
import {
  addLayer,
  addObject,
  createArtworkOperation,
  primaryOperationForObject,
  type ImportedSvg,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { formatDisplayMillimetres } from '../format-display-millimetres';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';
import { prepareIndependentArtwork, uniqueObjectId } from './vector-path-actions';

export type RubberBandOutlineActions = {
  /** Add a convex outline around the selection; returns true when it was added. */
  readonly addRubberBandOutline: () => boolean;
};

// The edition-aware setter returns false while a new Pro copy waits for admission.
type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => unknown;

export function rubberBandOutlineActions(set: Setter): RubberBandOutlineActions {
  return {
    addRubberBandOutline: () => {
      let added = false;
      let success: string | undefined;
      const committed = set((state) => {
        const next = rubberBandOutlineMutation(state, (message) => {
          success = message;
        });
        added = next !== state;
        return next;
      });
      if (committed === false) return false;
      if (added && success !== undefined) useToastStore.getState().pushToast(success, 'success');
      return added;
    },
  };
}

function rubberBandOutlineMutation(
  state: AppState,
  reportSuccess: (message: string) => void,
): AppState | Partial<AppState> {
  const ids = new Set(selectedObjectIds(state));
  const scene0 = state.project.scene;
  const selected = scene0.objects.filter((object) => ids.has(object.id));
  if (selected.length === 0) return state;
  const outline = rubberBandOutline(selected, uniqueObjectId(scene0, 'outline'));
  if (outline === null) {
    useToastStore
      .getState()
      .pushToast('The selection has no area to outline: it lies on one straight line.', 'warning');
    return state;
  }
  const bound = bindOutline(scene0, outline, selected);
  const scene = addObject(bound.scene, bound.object);
  const { minX, minY, maxX, maxY } = outline.bounds;
  reportSuccess(
    `Added a rubber-band outline around ${selected.length === 1 ? '1 object' : `${selected.length} objects`} (${formatDisplayMillimetres(maxX - minX)} × ${formatDisplayMillimetres(maxY - minY)} mm).`,
  );
  return {
    project: { ...state.project, scene },
    selectedObjectId: bound.object.id,
    additionalSelectedIds: new Set(),
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function bindOutline(
  scene: Scene,
  outline: ImportedSvg,
  selected: ReadonlyArray<SceneObject>,
): { readonly scene: Scene; readonly object: SceneObject } {
  const lineSource = selected.find(
    (object) => primaryOperationForObject(object, scene.layers)?.mode === 'line',
  );
  if (lineSource !== undefined) return prepareIndependentArtwork(scene, outline, lineSource);
  const seed = createArtworkOperation(scene, outline, { mode: 'line', name: 'Outline' });
  return { scene: addLayer(scene, seed.operation), object: seed.object };
}
