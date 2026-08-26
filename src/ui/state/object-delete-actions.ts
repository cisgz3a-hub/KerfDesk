import { removeObject, type Scene } from '../../core/scene';
import type { AppState } from './store';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import { useToastStore } from './toast-store';

export type ObjectDeleteActions = {
  readonly removeSceneObject: (id: string) => void;
  readonly removeSceneObjects: (ids: ReadonlyArray<string>) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function objectDeleteActions(set: Setter): ObjectDeleteActions {
  return {
    removeSceneObject: (id) => set((state) => removeSceneObjectFromState(state, id)),
    removeSceneObjects: (ids) => set((state) => removeSceneObjectsFromState(state, ids)),
  };
}

function removeSceneObjectFromState(state: AppState, id: string): AppState | Partial<AppState> {
  const nextExtras = new Set(state.additionalSelectedIds);
  nextExtras.delete(id);
  const repaired = repairDanglingImageMasks(
    removeObjectIdsFromGroups(removeObject(state.project.scene, id), new Set([id])),
  );
  if (repaired.repairedCount > 0) reportMaskRepair(repaired.repairedCount);
  const scene = pruneOrphanLayers(repaired.scene);
  return {
    project: { ...state.project, scene },
    selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
    additionalSelectedIds: nextExtras,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function removeSceneObjectsFromState(
  state: AppState,
  ids: ReadonlyArray<string>,
): AppState | Partial<AppState> {
  const uniqueIds = new Set(ids);
  if (uniqueIds.size === 0) return state;
  const objects = state.project.scene.objects.filter((object) => !uniqueIds.has(object.id));
  if (objects.length === state.project.scene.objects.length) return state;
  const nextExtras = new Set(state.additionalSelectedIds);
  for (const id of uniqueIds) nextExtras.delete(id);
  const repaired = repairDanglingImageMasks(
    removeObjectIdsFromGroups({ ...state.project.scene, objects }, uniqueIds),
  );
  if (repaired.repairedCount > 0) reportMaskRepair(repaired.repairedCount);
  return {
    project: {
      ...state.project,
      scene: pruneOrphanLayers(repaired.scene),
    },
    selectedObjectId:
      state.selectedObjectId !== null && uniqueIds.has(state.selectedObjectId)
        ? null
        : state.selectedObjectId,
    additionalSelectedIds: nextExtras,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

export function repairDanglingImageMasks(scene: Scene): {
  readonly scene: Scene;
  readonly repairedCount: number;
} {
  const liveIds = new Set(scene.objects.map((object) => object.id));
  let repairedCount = 0;
  const objects = scene.objects.map((object) => {
    if (
      object.kind !== 'raster-image' ||
      object.imageMaskId === undefined ||
      liveIds.has(object.imageMaskId)
    ) {
      return object;
    }
    repairedCount += 1;
    const { imageMaskId: _removed, ...unmasked } = object;
    return unmasked;
  });
  return repairedCount === 0
    ? { scene, repairedCount }
    : { scene: { ...scene, objects }, repairedCount };
}

function reportMaskRepair(count: number): void {
  useToastStore
    .getState()
    .pushToast(
      `${count} image mask reference${count === 1 ? '' : 's'} was removed because its mask artwork was deleted. The image remains editable and unmasked.`,
      'warning',
    );
}
