import { removeObject } from '../../core/scene';
import type { AppState } from './store';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import { removeObjectIdsFromGroups } from './scene-group-actions';

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
  const scene = pruneOrphanLayers(
    removeObjectIdsFromGroups(removeObject(state.project.scene, id), new Set([id])),
  );
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
  return {
    project: {
      ...state.project,
      scene: pruneOrphanLayers(
        removeObjectIdsFromGroups({ ...state.project.scene, objects }, uniqueIds),
      ),
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
