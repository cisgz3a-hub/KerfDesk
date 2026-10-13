// Drag-to-join (LightBurn Edit Nodes): drop an open endpoint onto another open
// endpoint of the same path and the two become one node. The dragged node is
// snapped exactly onto the target first, so Join merges them instead of
// bridging a hairline gap, and the drag and the join are one undo step.

import {
  applyTransform,
  curveNodeCount,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Project,
  type Vec2,
} from '../../core/scene';
import { materializeCurves } from './path-node-curve-command-actions';
import { planCurveNodeJoin } from './path-node-curve-join-plan';
import type { PathNodeRef } from './path-node-edit-actions';
import { boundsForPaths, editPathsNodesByDelta, pathNodePoint } from './path-node-edit-geometry';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';
import { useToastStore } from './toast-store';

export type PathNodeDragJoinActions = {
  /** Ends a node drag by joining the dragged endpoint to `target`; false when it cannot. */
  readonly joinDraggedPathNode: (target: PathNodeRef) => boolean;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function pathNodeDragJoinActions(set: Setter): PathNodeDragJoinActions {
  return {
    joinDraggedPathNode: (target) => {
      let message: string | null = null;
      set((state) => {
        const result = joinDragged(state, target);
        if (result === null) return state;
        message = result.message;
        return result.patch;
      });
      if (message !== null) useToastStore.getState().pushToast(message, 'success');
      return message !== null;
    },
  };
}

function joinDragged(
  state: AppState,
  target: PathNodeRef,
): { readonly patch: Partial<AppState>; readonly message: string } | null {
  const dragged = state.selectedPathNode;
  if (state.pendingUndo === null || dragged === null || state.selectedPathNodes.length !== 1) {
    return null;
  }
  const snapped = snapOnto(state.project, dragged, target);
  if (snapped === null) return null;
  const plan = planCurveNodeJoin(snapped, [dragged, target]);
  if (plan.kind !== 'success') return null;
  const objects = snapped.scene.objects.map((object) =>
    object.id === plan.object.id ? plan.object : object,
  );
  return {
    message: plan.message,
    patch: {
      project: { ...snapped, scene: { ...snapped.scene, objects } },
      undoStack: pushUndo(state.pendingUndo.project, state.pendingUndo.undoStack),
      redoStack: [],
      pendingUndo: null,
      dirty: true,
      selectedPathNode: null,
      selectedPathNodes: [],
    },
  };
}

// The project with the dragged endpoint moved exactly onto the target's
// local coordinates (its handle moving with it).
function snapOnto(project: Project, dragged: PathNodeRef, target: PathNodeRef): Project | null {
  const object = project.scene.objects.find((candidate) => candidate.id === dragged.objectId);
  if (object === undefined || !('paths' in object) || target.objectId !== object.id) return null;
  const from = pathNodePoint(object.paths, dragged);
  const to = pathNodePoint(object.paths, target);
  if (from === null || to === null) return null;
  const moved = editPathsNodesByDelta(object.paths, [dragged], to.x - from.x, to.y - from.y);
  const paths = exactEndpoint(moved?.paths ?? object.paths, dragged, to);
  if (paths === null) return null;
  const bounds = boundsForPaths(paths);
  const next =
    object.kind === 'shape'
      ? synchronizePolylineShapeGeometry(object, paths, bounds)
      : { ...object, paths, bounds };
  if (next === null) return null;
  const objects = project.scene.objects.map((candidate) =>
    candidate.id === object.id ? next : candidate,
  );
  return { ...project, scene: { ...project.scene, objects } };
}

function exactEndpoint(
  paths: ReadonlyArray<ColoredPath>,
  ref: PathNodeRef,
  point: Vec2,
): ReadonlyArray<ColoredPath> | null {
  const path = paths[ref.pathIndex];
  if (path === undefined) return null;
  let next: ColoredPath | null;
  if (ref.geometry === 'curve' && path.curves !== undefined) {
    const curve = path.curves[ref.polylineIndex];
    const placed = curve === undefined ? null : placeCurveEndpoint(curve, ref.pointIndex, point);
    next =
      placed === null
        ? null
        : materializeCurves(
            path,
            path.curves.map((candidate, index) =>
              index === ref.polylineIndex ? placed : candidate,
            ),
          );
  } else {
    const polylines = path.polylines.map((polyline, index) =>
      index === ref.polylineIndex
        ? {
            ...polyline,
            points: polyline.points.map((candidate, at) =>
              at === ref.pointIndex ? point : candidate,
            ),
          }
        : polyline,
    );
    next = { ...path, polylines };
  }
  return next === null
    ? null
    : paths.map((candidate, index) => (index === ref.pathIndex ? next : candidate));
}

function placeCurveEndpoint(curve: CurveSubpath, node: number, point: Vec2): CurveSubpath | null {
  if (curve.closed) return null;
  if (node === 0) return { ...curve, start: point };
  if (node !== curveNodeCount(curve) - 1) return null;
  const segments = curve.segments.map((segment, index) =>
    index === curve.segments.length - 1 ? { ...segment, to: point } : segment,
  );
  return { ...curve, segments };
}

/** Open endpoints of the dragged node's path, other than the dragged node itself. */
export function openEndpointRefs(
  project: Project,
  dragged: PathNodeRef,
): ReadonlyArray<PathNodeRef> {
  const object = project.scene.objects.find((candidate) => candidate.id === dragged.objectId);
  const path =
    object !== undefined && 'paths' in object ? object.paths[dragged.pathIndex] : undefined;
  if (path === undefined) return [];
  const curve = dragged.geometry === 'curve';
  const contours = path.curves ?? path.polylines.map(polylineToCurveSubpath);
  return contours.flatMap((contour, polylineIndex) => {
    if (contour.closed || contour.segments.length === 0) return [];
    const last = curve
      ? curveNodeCount(contour) - 1
      : (path.polylines[polylineIndex]?.points.length ?? 1) - 1;
    return [0, last]
      .map((pointIndex) => ({
        objectId: dragged.objectId,
        pathIndex: dragged.pathIndex,
        polylineIndex,
        pointIndex,
        ...(curve ? { geometry: 'curve' as const } : {}),
      }))
      .filter(
        (ref) =>
          ref.polylineIndex !== dragged.polylineIndex || ref.pointIndex !== dragged.pointIndex,
      );
  });
}

/** The nearest other open endpoint within `radiusMm` of the dragged node, in world space. */
export function dropTarget(
  project: Project,
  dragged: PathNodeRef,
  radiusMm: number,
): PathNodeRef | null {
  const object = project.scene.objects.find((candidate) => candidate.id === dragged.objectId);
  if (object === undefined || !('paths' in object)) return null;
  const from = pathNodePoint(object.paths, dragged);
  if (from === null) return null;
  const at = applyTransform(from, object.transform);
  let best: PathNodeRef | null = null;
  let bestDistance = radiusMm;
  for (const ref of openEndpointRefs(project, dragged)) {
    const point = pathNodePoint(object.paths, ref);
    if (point === null) continue;
    const world = applyTransform(point, object.transform);
    const distance = Math.hypot(world.x - at.x, world.y - at.y);
    if (distance <= bestDistance) {
      best = ref;
      bestDistance = distance;
    }
  }
  return best;
}
