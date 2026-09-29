// Copy Along Path (LightBurn gap LBG-T09): copies of the selected artwork
// spread along one guide path in the selection. The guide stays where it is,
// the copies keep the artwork's operations so they burn with the same
// settings, and the copies end up selected. One undo step. Keeping the
// original is optional; without it the copies replace the artwork.

import type { ArrayPlacement } from '../../core/scene/array-layout';
import type { Scene, SceneGroup } from '../../core/scene/scene';
import type { SceneObject } from '../../core/scene/scene-object';
import { cloneSelectedGroups } from './array-actions';
import { copyObjectsAtArrayPlacement } from './array-selection-copies';
import {
  planCopyAlongPath,
  type CopyAlongPathRequest,
  type ReadyCopyAlongPathSelection,
} from './copy-along-path-plan';
import { repairDanglingObjectDependencies, reportDependencyRepairs } from './object-delete-actions';
import { sceneLimitOverrun } from './scene-copy-room';
import { removeObjectIdsFromGroups, selectedObjectIds } from './scene-group-actions';
import { sceneObjectCopyClosure } from './scene-object-copy-dependencies';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type CopyAlongPathActions = {
  /** Copy the selected artwork along the guide path; returns true when copies were placed. */
  readonly copyAlongPath: (request: CopyAlongPathRequest) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function copyAlongPathActions(set: Setter): CopyAlongPathActions {
  return {
    copyAlongPath: (request) => {
      let placed = false;
      set((state) => {
        const next = copyAlongPathMutation(state, request);
        placed = next !== state;
        return next;
      });
      return placed;
    },
  };
}

/** The selection in stacking order. */
export function selectedSceneObjects(
  state: Pick<AppState, 'project' | 'selectedObjectId' | 'additionalSelectedIds'>,
): ReadonlyArray<SceneObject> {
  const ids = new Set(selectedObjectIds(state));
  return state.project.scene.objects.filter((object) => ids.has(object.id));
}

export function copyAlongPathMutation(
  state: AppState,
  request: CopyAlongPathRequest,
  idFactory: () => string = () => crypto.randomUUID(),
): AppState | Partial<AppState> {
  const plan = planCopyAlongPath(selectedSceneObjects(state), request, state.project.scene);
  if (plan.kind === 'problem') {
    useToastStore.getState().pushToast(plan.message, 'warning');
    return state;
  }
  const scene0 = state.project.scene;
  const copies = copiesAlongPath(scene0, plan.selection, plan.placements, idFactory);
  const placed: Scene = {
    ...scene0,
    objects: [...scene0.objects, ...copies.objects],
    groups: [...(scene0.groups ?? []), ...copies.groups],
  };
  const scene = request.keepOriginal ? placed : withoutOriginals(placed, plan.selection.artwork);
  // The room counted objects; groups the copies carry are held to their limits here.
  const overrun = sceneLimitOverrun(scene0, scene);
  if (overrun !== null) {
    useToastStore.getState().pushToast(overrun, 'warning');
    return state;
  }
  useToastStore.getState().pushToast(placedMessage(plan.placements.length, request), 'success');
  return {
    project: { ...state.project, scene },
    selectedObjectId: copies.selectedIds[0] ?? null,
    additionalSelectedIds: new Set(copies.selectedIds.slice(1)),
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack, 'Copy Along Path'),
    redoStack: [],
    dirty: true,
  };
}

// Each copy takes what the artwork needs with it (an image's mask, a path
// text's guide), and a group copied whole becomes a group of its own.
function copiesAlongPath(
  scene: Scene,
  selection: ReadyCopyAlongPathSelection,
  placements: ReadonlyArray<ArrayPlacement>,
  idFactory: () => string,
): {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly groups: ReadonlyArray<SceneGroup>;
  readonly selectedIds: ReadonlyArray<string>;
} {
  const artworkIds = new Set(selection.artwork.map((object) => object.id));
  const sources = sceneObjectCopyClosure(scene.objects, artworkIds);
  const sourceIds = new Set(sources.map((object) => object.id));
  // Only the groups that travel whole are copied, so find them once rather
  // than scanning every group in the project for every copy.
  const travelling = (scene.groups ?? []).filter((group) =>
    group.objectIds.every((id) => sourceIds.has(id)),
  );
  const objects: SceneObject[] = [];
  const groups: SceneGroup[] = [];
  const selectedIds: string[] = [];
  for (const placement of placements) {
    const copied = copyObjectsAtArrayPlacement(sources, placement, idFactory);
    objects.push(...copied.objects);
    groups.push(...cloneSelectedGroups(travelling, sourceIds, copied.ids, idFactory));
    for (const object of selection.artwork) {
      const id = copied.ids.get(object.id);
      if (id !== undefined) selectedIds.push(id);
    }
  }
  return { objects, groups, selectedIds };
}

// As Delete does: a mask or text guide left without its artwork is let go,
// with a notice.
function withoutOriginals(scene: Scene, artwork: ReadonlyArray<SceneObject>): Scene {
  const ids = new Set(artwork.map((object) => object.id));
  const remaining = { ...scene, objects: scene.objects.filter((object) => !ids.has(object.id)) };
  const repaired = repairDanglingObjectDependencies(removeObjectIdsFromGroups(remaining, ids));
  reportDependencyRepairs(repaired);
  return pruneOrphanLayers(repaired.scene);
}

function placedMessage(count: number, request: CopyAlongPathRequest): string {
  const copies = count === 1 ? '1 copy' : `${count} copies`;
  return request.keepOriginal
    ? `Placed ${copies} along the guide path.`
    : `Placed ${copies} along the guide path in place of the original.`;
}
