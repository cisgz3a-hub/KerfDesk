// Radius / Fillet on the workspace selection (LightBurn Tools): round, bite
// (reverse radius) or un-round the corners of editable vector artwork, in one
// undo step. With nodes picked in the node tool, only those corners change;
// otherwise every corner of the selection does. The radius is in world
// millimetres, so a non-uniformly scaled object, whose circles would turn
// into ellipses, is left alone and reported.

import {
  filletCurveCorners,
  removeCurveFillets,
  type FilletMode,
} from '../../core/geometry/curve-fillet';
import { polylineToCurveSubpath, type CurveSubpath } from '../../core/scene';
import { isPathEditable } from './path-cleanup-actions';
import { materializeCurves } from './path-node-curve-command-actions';
import { boundsForPaths } from './path-node-edit-geometry';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import { selectedObjectIds } from './scene-group-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type FilletAction = FilletMode | 'remove';

export type PathFilletActions = {
  readonly filletSelection: (radiusMm: number, action: FilletAction) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

const UNIFORM_TOLERANCE = 1e-9;

export function pathFilletActions(set: Setter): PathFilletActions {
  return {
    filletSelection: (radiusMm, action) => set((state) => filletMutation(state, radiusMm, action)),
  };
}

function filletMutation(
  state: AppState,
  radiusMm: number,
  action: FilletAction,
): AppState | Partial<AppState> {
  if (action !== 'remove' && !(radiusMm > 0)) return state;
  const ids = new Set(selectedObjectIds(state));
  let corners = 0;
  let stretched = 0;
  const objects = state.project.scene.objects.map((object) => {
    if (!ids.has(object.id) || object.locked === true || !isPathEditable(object)) return object;
    const { scaleX, scaleY } = object.transform;
    if (action !== 'remove' && Math.abs(Math.abs(scaleX) - Math.abs(scaleY)) > UNIFORM_TOLERANCE) {
      stretched += 1;
      return object;
    }
    const localRadius = radiusMm / Math.abs(scaleX);
    const picked = state.selectedPathNodes.filter((node) => node.objectId === object.id);
    let changed = false;
    const paths = object.paths.map((path, pathIndex) => {
      const curves = path.curves ?? path.polylines.map(polylineToCurveSubpath);
      const edited = curves.map((curve, curveIndex): CurveSubpath => {
        const nodes = picked
          .filter((node) => node.pathIndex === pathIndex && node.polylineIndex === curveIndex)
          .map((node) => node.pointIndex);
        if (picked.length > 0 && nodes.length === 0) return curve;
        const result =
          action === 'remove'
            ? removeCurveFillets(curve)
            : filletCurveCorners(curve, localRadius, action, picked.length > 0 ? nodes : undefined);
        if (result === null) return curve;
        corners += result.count;
        return result.curve;
      });
      if (edited.every((curve, index) => curve === curves[index])) return path;
      const next = materializeCurves(path, edited);
      if (next === null) return path;
      changed = true;
      return next;
    });
    if (!changed) return object;
    const bounds = boundsForPaths(paths);
    return object.kind === 'shape'
      ? (synchronizePolylineShapeGeometry(object, paths, bounds) ?? object)
      : { ...object, paths, bounds };
  });
  useToastStore.getState().pushToast(message(action, corners, stretched), 'info');
  if (corners === 0) return state;
  return {
    project: { ...state.project, scene: { ...state.project.scene, objects } },
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
    selectedPathNode: null,
    selectedPathNodes: [],
  };
}

function message(action: FilletAction, corners: number, stretched: number): string {
  const skipped =
    stretched === 0
      ? ''
      : ` ${stretched === 1 ? '1 object was' : `${stretched} objects were`} skipped: stretched unevenly, its arcs would not be round.`;
  if (corners === 0) {
    const none =
      action === 'remove'
        ? 'No rounded corners to remove: only an arc meeting two straight sides tangentially is a fillet.'
        : 'No corner could take that radius: a corner needs two straight sides long enough for the arc.';
    return `${none}${skipped}`;
  }
  const count = corners === 1 ? '1 corner' : `${corners} corners`;
  const verb = action === 'remove' ? 'Sharpened' : action === 'reverse' ? 'Bit' : 'Rounded';
  return `${verb} ${count}.${skipped}`;
}
