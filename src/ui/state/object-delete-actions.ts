import { removeObject } from '../../core/scene';
import type { AppState } from './store';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import { useToastStore } from './toast-store';
import { repairDanglingObjectDependencies } from './repair-object-dependencies';

export { repairDanglingObjectDependencies } from './repair-object-dependencies';

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

export function reportDependencyRepairs(
  repair: Pick<
    ReturnType<typeof repairDanglingObjectDependencies>,
    'repairedImageMasks' | 'repairedPathTextGuides'
  >,
  reason: 'deleted' | 'unavailable-vector' | 'replaced' = 'deleted',
): void {
  const messages: string[] = [];
  const cause =
    reason === 'deleted'
      ? 'was deleted'
      : reason === 'replaced'
        ? 'was merged into a new shape'
        : 'is no longer available as a vector';
  if (repair.repairedImageMasks > 0) {
    messages.push(
      `${repair.repairedImageMasks} image mask reference${repair.repairedImageMasks === 1 ? '' : 's'} was removed because its mask artwork ${cause}. The image remains editable and unmasked.`,
    );
  }
  if (repair.repairedPathTextGuides > 0) {
    messages.push(
      `${repair.repairedPathTextGuides} path-text guide reference${repair.repairedPathTextGuides === 1 ? '' : 's'} was removed because its guide artwork ${cause}. The stored text geometry remains in place and editable.`,
    );
  }
  if (messages.length > 0) useToastStore.getState().pushToast(messages.join(' '), 'warning');
}
