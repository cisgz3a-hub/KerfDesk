// Shear the workspace selection (LightBurn skew), baked into vector geometry
// about the centre of the selection, in one undo step. Only editable vector
// artwork can take a shear: text, drawn rectangles and ellipses, and images
// rebuild their own geometry, so they are left alone and reported.

import { tabKeptPlaceMm, withTabsFollowingMap } from '../../core/geometry/edited-tab-anchors';
import {
  bakeCurves,
  localBakeMatrix,
  MAX_SHEAR_DEG,
  SHEAR_FLATTENS_MESSAGE,
  shearKeepsShape,
  worldShear,
} from '../../core/geometry/shear-bake';
import { combinedBBox, polylineToCurveSubpath } from '../../core/scene';
import { isPathEditable } from './path-cleanup-actions';
import { materializeCurves } from './path-node-curve-command-actions';
import { movedTabsNotice } from './path-node-edit-actions';
import { boundsForPaths } from './path-node-edit-geometry';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type ShearActions = {
  /** Horizontal and vertical shear angles in degrees, each within ±MAX_SHEAR_DEG. */
  readonly shearSelection: (angleXDeg: number, angleYDeg: number) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function shearActions(set: Setter): ShearActions {
  return { shearSelection: (ax, ay) => set((state) => shearMutation(state, ax, ay)) };
}

function inRange(angle: number): boolean {
  return Number.isFinite(angle) && Math.abs(angle) <= MAX_SHEAR_DEG;
}

function shearMutation(state: AppState, ax: number, ay: number): AppState | Partial<AppState> {
  if (!inRange(ax) || !inRange(ay) || (ax === 0 && ay === 0)) return state;
  if (!shearKeepsShape(ax, ay)) {
    toast(SHEAR_FLATTENS_MESSAGE);
    return state;
  }
  const ids = new Set(selectedObjectIds(state));
  const selected = state.project.scene.objects.filter(
    (object) => ids.has(object.id) && object.locked !== true,
  );
  const targets = selected.filter(isPathEditable);
  const box = combinedBBox(targets);
  const skipped = selected.length - targets.length;
  if (box === null) {
    toast(
      'Shear works on imported, traced or drawn-line artwork. Convert text and shapes to paths first.',
    );
    return state;
  }
  const world = worldShear({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, ax, ay);
  const targetIds = new Set(targets.map((object) => object.id));
  let sheared = 0;
  let movedTabs = 0;
  const objects = state.project.scene.objects.map((object) => {
    if (!targetIds.has(object.id) || !isPathEditable(object)) return object;
    const matrix = localBakeMatrix(object.transform, world);
    if (matrix === null) return object;
    const paths = object.paths.map((path) => {
      const curves = bakeCurves(path.curves ?? path.polylines.map(polylineToCurveSubpath), matrix);
      return materializeCurves(path, curves) ?? path;
    });
    const bounds = boundsForPaths(paths);
    const next =
      object.kind === 'shape'
        ? synchronizePolylineShapeGeometry(object, paths, bounds)
        : { ...object, paths, bounds };
    if (next === null) return object;
    sheared += 1;
    // A shear lengthens some edges and not others, so a tab keeps its place on
    // the sheared outline rather than its share of the whole contour.
    const followed = withTabsFollowingMap(object, next, {
      place: (point) => ({
        x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f,
      }),
      keptPlaceMm: tabKeptPlaceMm(
        Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)),
      ),
    });
    movedTabs += followed.moved;
    return followed.object;
  });
  if (sheared === 0) return state;
  const note =
    skipped === 0
      ? ''
      : ` ${skipped === 1 ? '1 object was' : `${skipped} objects were`} left unchanged: convert text, shapes and images to paths to shear them.`;
  const tabs = movedTabsNotice(movedTabs);
  toast(
    `Sheared ${sheared === 1 ? '1 object' : `${sheared} objects`}.${note}${tabs === '' ? '' : ` ${tabs}`}`,
  );
  return {
    project: { ...state.project, scene: { ...state.project.scene, objects } },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
    selectedPathNode: null,
    selectedPathNodes: [],
  };
}

function toast(message: string): void {
  useToastStore.getState().pushToast(message, 'info');
}
