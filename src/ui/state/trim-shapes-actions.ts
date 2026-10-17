import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
// Trim Shapes (LightBurn gap LBG-T04): a click deletes the highlighted stretch
// of outline, as one undo step. Imported and traced artwork is edited in
// place, and a drawn line stays a drawn line while one piece of it is left.
// Text and drawn rectangles, ellipses, polygons, stars and barcodes rebuild
// their paths from their settings, so a trim turns them into plain paths in
// the same undo step, keeping their placement and exact curves, and says so.
// An object left with no outline is deleted.

import { localPathArtwork } from '../../core/geometry/local-path-artwork';
import { isUnlockedVectorArtwork } from '../../core/geometry/trim-contours';
import { remapTrimmedAnchors, trimEdit, type TrimEdit } from '../../core/geometry/trim-shape-edit';
import { findTrimTarget } from '../../core/geometry/trim-shapes';
import { pathBoundOperationIds } from '../../core/geometry/vector-path-join';
import { boundsForPaths, type VectorSceneObject } from '../../core/geometry/vector-path-tools';
import {
  removeObject,
  replaceObject,
  type Scene,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import { autoJoinTrimmed, preservedStretch } from './trim-shapes-extras';
import { repairDanglingObjectDependencies, reportDependencyRepairs } from './object-delete-actions';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import { removeObjectIdsFromGroups } from './scene-group-actions';
import { pruneOrphanLayers, pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type TrimShapesActions = {
  /** Delete the stretch of outline within `toleranceMm` of `point`; true when one was trimmed. */
  readonly trimShapeAt: (point: Vec2, toleranceMm: number, options?: TrimOptions) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export type TrimOptions = {
  /** Join the cut ends to open contours meeting them (LightBurn default; Ctrl turns it off). */
  readonly autoJoin?: boolean;
  /** Keep a copy of the deleted stretch on the drawing layer (LightBurn Shift+click). */
  readonly keepRemoved?: { readonly color: string };
};

type Trimmed = { readonly object: SceneObject; readonly converted: string | null };

export function trimShapesActions(set: Setter): TrimShapesActions {
  return {
    trimShapeAt: (point, toleranceMm, options = {}) => {
      let trimmed = false;
      set((state) => {
        const next = trimShapeMutation(state, point, toleranceMm, options);
        trimmed = next !== state;
        return next;
      });
      return trimmed;
    },
  };
}

function trimShapeMutation(
  state: AppState,
  point: Vec2,
  toleranceMm: number,
  options: TrimOptions,
): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const target = findTrimTarget(scene, point, toleranceMm);
  const object = scene.objects.find((entry) => entry.id === target?.contour.objectId);
  if (target === null || object === undefined || !isUnlockedVectorArtwork(object)) return state;
  if (isBooleanCompoundObject(object)) {
    notify('Edit compound sources or Expand before trimming the result.');
    return state;
  }
  const edit = trimEdit(object, target);
  if (edit === null) return state;
  const history = {
    undoStack: pushUndo(state.project, state.undoStack, 'Trim Shapes'),
    redoStack: [],
    dirty: true,
    selectedPathNode: null,
    selectedPathNodes: [],
  } as const;
  if (edit.paths.every((path) => path.polylines.length === 0)) {
    const kept = keptStretch(state, object, edit, options);
    return { ...removeTrimmedObject(state, object.id, kept), ...history };
  }
  return { ...trimmedScenePatch(state, object, edit, options), ...history };
}

function trimmedScenePatch(
  state: AppState,
  object: VectorSceneObject,
  edit: TrimEdit,
  options: TrimOptions,
): Partial<AppState> {
  const scene = state.project.scene;
  const trimmed = trimmedObject(object, edit);
  if (trimmed.converted !== null) notify(conversionMessage(trimmed.converted));
  const replaced = replaceObject(scene, object.id, trimmed.object).objects;
  const kept = keptStretch(state, object, edit, options);
  const joined =
    options.autoJoin === true
      ? autoJoinTrimmed(replaced, trimmed.object, edit, scene.layers)
      : null;
  const objects = [...(joined?.objects ?? replaced), ...(kept === null ? [] : [kept])];
  const nextScene =
    joined === null ? { ...scene, objects } : repairedScene({ ...scene, objects }, replaced);
  return {
    project: { ...state.project, scene: nextScene },
    ...(joined === null
      ? {}
      : { selectedObjectId: object.id, additionalSelectedIds: new Set<string>() }),
  };
}

function trimmedObject(object: VectorSceneObject, edit: TrimEdit): Trimmed {
  const bounds = boundsForPaths(edit.paths) ?? object.bounds;
  const anchors = {
    ...(object.cncTabAnchors === undefined
      ? {}
      : { cncTabAnchors: remapTrimmedAnchors(object.cncTabAnchors, edit) }),
    ...(object.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: remapTrimmedAnchors(object.laserTabAnchors, edit) }),
  };
  if (object.kind === 'imported-svg' || object.kind === 'traced-image') {
    return { object: { ...object, paths: edit.paths, bounds, ...anchors }, converted: null };
  }
  if (object.kind === 'shape' && object.spec.kind === 'polyline') {
    const kept = synchronizePolylineShapeGeometry({ ...object, ...anchors }, edit.paths, bounds);
    if (kept !== null) return { object: kept, converted: null };
  }
  const converted = { ...localPathArtwork(object), paths: edit.paths, bounds, ...anchors };
  return { object: converted, converted: conversionLabel(object) };
}

function keptStretch(
  state: AppState,
  // The object before the trim, so the trimmed path is still at `edit.pathIndex`.
  trimmed: VectorSceneObject,
  edit: TrimEdit,
  options: TrimOptions,
): SceneObject | null {
  if (options.keepRemoved === undefined) return null;
  const copy = preservedStretch(state.project, trimmed, edit, options.keepRemoved.color);
  if (copy === null) return null;
  const placed =
    copy.operationIds === undefined && trimmed.operationIds !== undefined
      ? { ...copy, operationIds: trimmed.operationIds }
      : copy;
  // Compare what each actually cuts by: a path binding wins over the artwork's.
  const operations = state.project.scene.layers;
  const source = trimmed.paths[edit.pathIndex];
  const copyPath = placed.paths[0];
  const trimmedIds = new Set(
    source === undefined ? [] : pathBoundOperationIds(trimmed, source, operations),
  );
  const sameLayer =
    copyPath !== undefined &&
    pathBoundOperationIds(placed, copyPath, operations).some((id) => trimmedIds.has(id));
  if (sameLayer)
    notify('The kept segment is on the same layer as the trimmed shape, so it will be cut too.');
  return placed;
}

// Objects a join emptied are gone: drop them from groups and repair what depended on them.
function repairedScene(scene: Scene, before: ReadonlyArray<SceneObject>): Scene {
  const remaining = new Set(scene.objects.map((object) => object.id));
  const removed = new Set(
    before.filter((object) => !remaining.has(object.id)).map((object) => object.id),
  );
  if (removed.size === 0) return scene;
  const repaired = repairDanglingObjectDependencies(removeObjectIdsFromGroups(scene, removed));
  reportDependencyRepairs(repaired);
  return pruneOrphanLayers(repaired.scene);
}

function removeTrimmedObject(
  state: AppState,
  id: string,
  kept: SceneObject | null,
): Partial<AppState> {
  const ids = new Set([id]);
  const removed = removeObject(state.project.scene, id);
  const scene = kept === null ? removed : { ...removed, objects: [...removed.objects, kept] };
  const repaired = repairDanglingObjectDependencies(removeObjectIdsFromGroups(scene, ids));
  reportDependencyRepairs(repaired);
  const additionalSelectedIds = new Set(state.additionalSelectedIds);
  additionalSelectedIds.delete(id);
  return {
    project: { ...state.project, scene: pruneOrphanLayers(repaired.scene) },
    selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
    additionalSelectedIds,
  };
}

// Null for a drawn line: it has no settings to lose.
function conversionLabel(object: VectorSceneObject): string | null {
  if (object.kind === 'text') return 'text';
  if (object.kind !== 'shape') return null;
  switch (object.spec.kind) {
    case 'rect':
      return 'rectangle';
    case 'ellipse':
      return 'ellipse';
    case 'polygon':
      return 'polygon';
    case 'star':
      return 'star';
    case 'barcode':
      return 'barcode';
    case 'polyline':
      return null;
  }
}

function conversionMessage(label: string): string {
  return label === 'text'
    ? 'The trimmed text is now a plain path, so it can no longer be edited as text. Undo restores it.'
    : `The trimmed ${label} is now a plain path, so its ${label} settings no longer apply. Undo restores it.`;
}

function notify(message: string): void {
  useToastStore.getState().pushToast(message, 'info');
}
