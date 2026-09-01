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
  const repaired = repairDanglingObjectDependencies(
    removeObjectIdsFromGroups(removeObject(state.project.scene, id), new Set([id])),
  );
  reportDependencyRepairs(repaired);
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

export function removeSceneObjectsFromState(
  state: AppState,
  ids: ReadonlyArray<string>,
): AppState | Partial<AppState> {
  const uniqueIds = new Set(ids);
  if (uniqueIds.size === 0) return state;
  const objects = state.project.scene.objects.filter((object) => !uniqueIds.has(object.id));
  if (objects.length === state.project.scene.objects.length) return state;
  const nextExtras = new Set(state.additionalSelectedIds);
  for (const id of uniqueIds) nextExtras.delete(id);
  const repaired = repairDanglingObjectDependencies(
    removeObjectIdsFromGroups({ ...state.project.scene, objects }, uniqueIds),
  );
  reportDependencyRepairs(repaired);
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

export function repairDanglingObjectDependencies(scene: Scene): {
  readonly scene: Scene;
  readonly repairedImageMasks: number;
  readonly repairedPathTextGuides: number;
} {
  const liveIds = new Set(scene.objects.map((object) => object.id));
  let repairedImageMasks = 0;
  let repairedPathTextGuides = 0;
  const objects = scene.objects.map((object) => {
    if (
      object.kind === 'raster-image' &&
      object.imageMaskId !== undefined &&
      !liveIds.has(object.imageMaskId)
    ) {
      repairedImageMasks += 1;
      const { imageMaskId: _removed, ...unmasked } = object;
      return unmasked;
    }
    if (
      object.kind === 'text' &&
      object.pathText !== undefined &&
      !liveIds.has(object.pathText.guideObjectId)
    ) {
      repairedPathTextGuides += 1;
      const { pathText: _removed, ...materialized } = object;
      return materialized;
    }
    return object;
  });
  return repairedImageMasks === 0 && repairedPathTextGuides === 0
    ? { scene, repairedImageMasks, repairedPathTextGuides }
    : { scene: { ...scene, objects }, repairedImageMasks, repairedPathTextGuides };
}

function reportDependencyRepairs(
  repair: Pick<
    ReturnType<typeof repairDanglingObjectDependencies>,
    'repairedImageMasks' | 'repairedPathTextGuides'
  >,
): void {
  const messages: string[] = [];
  if (repair.repairedImageMasks > 0) {
    messages.push(
      `${repair.repairedImageMasks} image mask reference${repair.repairedImageMasks === 1 ? '' : 's'} was removed because its mask artwork was deleted. The image remains editable and unmasked.`,
    );
  }
  if (repair.repairedPathTextGuides > 0) {
    messages.push(
      `${repair.repairedPathTextGuides} path-text guide reference${repair.repairedPathTextGuides === 1 ? '' : 's'} was removed because its guide artwork was deleted. The stored text geometry remains in place and editable.`,
    );
  }
  if (messages.length > 0) useToastStore.getState().pushToast(messages.join(' '), 'warning');
}
