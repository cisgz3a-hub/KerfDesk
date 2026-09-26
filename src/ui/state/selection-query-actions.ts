// Selection queries from LightBurn's Edit menu (LightBurn gap batch 3,
// ADR-410): Invert Selection and Select Open Shapes. Like Select All, both only
// pick artwork the user could click: unlocked and on a visible operation.
// https://docs.lightburnsoftware.com/latest/Reference/UI/EditMenu/

import {
  isClosedEnough,
  sceneObjectHasVisibleLayer,
  type Polyline,
  type Scene,
  type SceneObject,
} from '../../core/scene';
import { scopedSelectionProjectPatch } from './project-job-setup';
import { selectedObjectIds, selectionFromIds } from './scene-group-actions';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type SelectionQueryActions = {
  /** Select every pickable object that is not selected, and deselect the rest. */
  readonly invertSelection: () => void;
  /** Select every pickable object with a path whose ends do not meet. */
  readonly selectOpenShapes: () => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function selectionQueryActions(set: Setter): SelectionQueryActions {
  return {
    invertSelection: () =>
      set((state) => {
        const current = new Set(selectedObjectIds(state));
        const ids = pickableObjects(state.project.scene)
          .filter((object) => !current.has(object.id))
          .map((object) => object.id);
        return selectIds(state, ids);
      }),
    selectOpenShapes: () =>
      set((state) => {
        const found = pickableObjects(state.project.scene).flatMap((object) => {
          const count = openPathCount(object);
          return count === 0 ? [] : [{ id: object.id, count }];
        });
        useToastStore.getState().pushToast(openShapesMessage(found), 'info');
        // Nothing to select: keep the user's selection rather than clearing it.
        if (found.length === 0) return state;
        return selectIds(
          state,
          found.map((entry) => entry.id),
        );
      }),
  };
}

/** Open paths in an object: two or more points whose ends do not meet. */
export function openPathCount(object: SceneObject): number {
  if (!('paths' in object)) return 0;
  return object.paths
    .flatMap((path) => path.polylines)
    .filter((polyline) => isOpenPolyline(polyline)).length;
}

function isOpenPolyline(polyline: Polyline): boolean {
  return polyline.points.length >= 2 && !isClosedEnough(polyline);
}

function pickableObjects(scene: Scene): ReadonlyArray<SceneObject> {
  return scene.objects.filter(
    (object) => object.locked !== true && sceneObjectHasVisibleLayer(scene, object),
  );
}

function selectIds(state: AppState, ids: ReadonlyArray<string>): Partial<AppState> {
  return {
    ...scopedSelectionProjectPatch(state, selectionFromIds(state, ids, false)),
    selectedPathNode: null,
    selectedPathNodes: [],
  };
}

function openShapesMessage(found: ReadonlyArray<{ readonly count: number }>): string {
  if (found.length === 0) return 'No open shapes: every visible, unlocked path is closed.';
  const paths = found.reduce((sum, entry) => sum + entry.count, 0);
  const objects = found.length === 1 ? '1 object' : `${found.length} objects`;
  const openPaths = paths === 1 ? '1 open path' : `${paths} open paths`;
  return `Selected ${objects} with ${openPaths}. Tools > Join paths can close gaps between ends.`;
}
