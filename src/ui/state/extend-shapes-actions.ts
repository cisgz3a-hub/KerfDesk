import { extendEdit, findExtendTarget, type ExtendTarget } from '../../core/geometry/extend-shapes';
import { localPathArtwork } from '../../core/geometry/local-path-artwork';
import { isUnlockedVectorArtwork } from '../../core/geometry/trim-contours';
import type { VectorSceneObject } from '../../core/geometry/vector-path-tools';
import { replaceObject, type ColoredPath, type SceneObject, type Vec2 } from '../../core/scene';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import { boundsForPaths } from './path-node-edit-geometry';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type ExtendShapesActions = {
  readonly extendShapeAt: (point: Vec2, toleranceMm: number) => boolean;
};
type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function extendShapesActions(set: Setter): ExtendShapesActions {
  return {
    extendShapeAt: (point, toleranceMm) => {
      let changed = false;
      set((state) => {
        const next = extendMutation(state, point, toleranceMm);
        changed = next !== state;
        return next;
      });
      return changed;
    },
  };
}

function extendMutation(
  state: AppState,
  point: Vec2,
  toleranceMm: number,
): AppState | Partial<AppState> {
  const scene = state.project.scene;
  const target = findExtendTarget(scene, point, toleranceMm);
  const object = scene.objects.find((entry) => entry.id === target?.contour.objectId);
  if (target === null || object === undefined || !isUnlockedVectorArtwork(object)) return state;
  if (isBooleanCompoundObject(object)) {
    notify('Edit compound sources or Expand before extending the result.');
    return state;
  }
  if (target.status !== 'ready') {
    notify(failureMessage(target.status));
    return state;
  }
  const paths = extendEdit(object, target);
  if (paths === null) {
    notify('This outline could not be extended. Its geometry was not changed.');
    return state;
  }
  const extended = extendedObject(object, paths, target);
  return {
    project: { ...state.project, scene: replaceObject(scene, object.id, extended) },
    undoStack: pushUndo(state.project, state.undoStack, 'Extend Shapes'),
    redoStack: [],
    dirty: true,
    selectedPathNode: null,
    selectedPathNodes: [],
  };
}

function extendedObject(
  object: VectorSceneObject,
  paths: readonly ColoredPath[],
  target: ExtendTarget,
): SceneObject {
  const bounds = boundsForPaths(paths);
  const anchors = extendedAnchors(object, target);
  if (object.kind === 'imported-svg' || object.kind === 'traced-image')
    return { ...object, paths, bounds, ...anchors };
  if (object.kind === 'shape' && object.spec.kind === 'polyline') {
    const synced = synchronizePolylineShapeGeometry({ ...object, ...anchors }, paths, bounds);
    if (synced !== null) return synced;
  }
  notify('The extended artwork is now a plain path. Undo restores its editable settings.');
  return {
    ...localPathArtwork({ ...object, paths, bounds, ...anchors }),
    ...(object.name === undefined ? {} : { name: object.name }),
  };
}

// Placed tabs resolve only on closed contours. A saved anchor on this open
// contour is stale; drop it like Trim does, while retaining other contours.
function extendedAnchors(
  object: VectorSceneObject,
  target: ExtendTarget,
): Pick<SceneObject, 'cncTabAnchors' | 'laserTabAnchors'> {
  const keepAnchor = (anchor: { readonly pathIndex: number; readonly polylineIndex: number }) =>
    anchor.pathIndex !== target.contour.pathIndex ||
    anchor.polylineIndex !== target.contour.polylineIndex;
  const anchors = {
    ...(object.cncTabAnchors === undefined
      ? {}
      : { cncTabAnchors: object.cncTabAnchors.filter(keepAnchor) }),
    ...(object.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: object.laserTabAnchors.filter(keepAnchor) }),
  };
  if (
    (object.cncTabAnchors?.some((anchor) => !keepAnchor(anchor)) ?? false) ||
    (object.laserTabAnchors?.some((anchor) => !keepAnchor(anchor)) ?? false)
  ) {
    notify('Placed tabs on the extended contour were removed. Undo restores them.');
  }
  return anchors;
}

function failureMessage(status: Exclude<ExtendTarget['status'], 'ready'>): string {
  switch (status) {
    case 'no-boundary':
      return 'No boundary ahead. The endpoint was not changed.';
    case 'already-touching':
      return 'This endpoint already touches a boundary.';
    case 'overlap':
      return 'This endpoint overlaps a boundary. The endpoint was not changed.';
    case 'curved-end':
      return 'This endpoint has no usable tangent and was not changed.';
    case 'degenerate':
      return 'This endpoint has no usable direction and was not changed.';
  }
}
function notify(message: string): void {
  useToastStore.getState().pushToast(message, 'info');
}
