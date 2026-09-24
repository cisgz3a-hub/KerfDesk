// selection-cleanup-actions — Edit → Delete Duplicates and Tools → Rubber-band
// outline (ADR-377). Each is one undo step and reports what it did in a toast.

import { planDeleteDuplicates } from '../../core/geometry/delete-duplicates';
import { rubberBandOutline } from '../../core/geometry/rubber-band-outline';
import {
  addLayer,
  addObject,
  createArtworkOperation,
  nextOperationColor,
  sceneObjectHasVisibleLayer,
  type Scene,
} from '../../core/scene';
import { repairDanglingObjectDependencies, reportDependencyRepairs } from './object-delete-actions';
import { applyLayerDefaultsToFreshLayers } from './object-insert-actions';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type SelectionCleanupActions = {
  // Remove repeated contours from the selection, or from the whole design when
  // nothing is selected. Locked, hidden and image objects are left alone.
  readonly deleteDuplicates: () => void;
  // Add the selection's convex outline as a new shape on a new Line operation.
  readonly createRubberBandOutline: () => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function selectionCleanupActions(set: Setter): SelectionCleanupActions {
  return {
    deleteDuplicates: () => set((state) => deleteDuplicatesInState(state)),
    createRubberBandOutline: () => set((state) => rubberBandOutlineInState(state)),
  };
}

function deleteDuplicatesInState(state: AppState): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const selected = new Set(selectedObjectIds(state));
  const candidates = scene.objects.filter(
    (object) =>
      (selected.size === 0 || selected.has(object.id)) &&
      object.locked !== true &&
      sceneObjectHasVisibleLayer(scene, object),
  );
  const plan = planDeleteDuplicates(candidates, { keepIds: referencedObjectIds(scene) });
  const toast = useToastStore.getState().pushToast;
  if (plan.removedContourCount === 0) {
    toast(selected.size === 0 ? 'No duplicates found.' : 'No duplicates in the selection.', 'info');
    return state;
  }
  const removed = plan.removedObjectIds;
  const objects = scene.objects.flatMap((object) =>
    removed.has(object.id) ? [] : [plan.editedObjects.get(object.id) ?? object],
  );
  const repaired = repairDanglingObjectDependencies(
    removeObjectIdsFromGroups(
      {
        ...scene,
        objects,
        ...(scene.artworkOrder === undefined
          ? {}
          : { artworkOrder: scene.artworkOrder.filter((id) => !removed.has(id)) }),
      },
      removed,
    ),
  );
  reportDependencyRepairs(repaired);
  const count = plan.removedContourCount;
  toast(`Deleted ${count} duplicate ${count === 1 ? 'path' : 'paths'}.`, 'success');
  return {
    project: { ...state.project, scene: pruneOrphanLayers(repaired.scene) },
    selectedObjectId:
      state.selectedObjectId !== null && removed.has(state.selectedObjectId)
        ? null
        : state.selectedObjectId,
    additionalSelectedIds: new Set(
      [...state.additionalSelectedIds].filter((id) => !removed.has(id)),
    ),
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

// An image's mask and a path text's guide: removing or trimming one would
// change the object that depends on it.
function referencedObjectIds(scene: Scene): ReadonlySet<string> {
  return new Set(
    scene.objects.flatMap((object) => {
      if (object.kind === 'raster-image') return object.imageMaskId ?? [];
      if (object.kind === 'text') return object.pathText?.guideObjectId ?? [];
      return [];
    }),
  );
}

function rubberBandOutlineInState(state: AppState): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const selected = new Set(selectedObjectIds(state));
  const id = `outline-${crypto.randomUUID()}`;
  // Drawn in the colour its new operation is about to take.
  const result = rubberBandOutline(
    scene.objects.filter((object) => selected.has(object.id)),
    id,
    nextOperationColor(scene.layers),
  );
  if (result.kind === 'error') {
    useToastStore.getState().pushToast(result.error.message, 'warning');
    return state;
  }
  const created = createArtworkOperation(scene, result.value, {
    mode: 'line',
    name: 'Rubber-band outline',
  });
  const next = applyLayerDefaultsToFreshLayers(
    scene.layers,
    {
      project: {
        ...state.project,
        scene: addObject(addLayer(scene, created.operation), created.object),
      },
    },
    state.layerDefaults,
    state.cncLiveCaps,
  );
  return {
    project: next.project,
    selectedObjectId: id,
    additionalSelectedIds: new Set<string>(),
    selectionOrder: [id],
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
