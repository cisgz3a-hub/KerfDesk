// Segment edits of the workspace node tool (LightBurn Edit Nodes): insert a
// node at a point on a segment or at its midpoint, and delete a segment. A
// segment is addressed by the contour that owns it, like a node is.

import {
  curveSegmentCount,
  deleteCurveSegment,
  dragCurveSegment,
  insertCurveNode,
} from '../../core/geometry/curve-segment-edit';
import {
  breakCurveAtNode,
  curveNodeCount,
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Vec2,
} from '../../core/scene';
import { closedCurveBreak, brokenTabAnchors } from '../../core/cnc/cnc-tab-anchors';
import type { PathNodeRef } from './path-node-edit-actions';
import {
  isCurveCommandObject,
  materializeCurves,
  mutateObjectCurve,
  withShiftedContourTabs,
} from './path-node-curve-command-actions';
import { boundsForPaths } from './path-node-edit-geometry';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import type { AppState } from './store';

export type PathSegmentRef = {
  readonly objectId: string;
  readonly pathIndex: number;
  readonly curveIndex: number;
  readonly segmentIndex: number;
  /** Where on the segment the pointer is, 0..1. */
  readonly t: number;
};

export type PathSegmentActions = {
  /** Inserts a node at the segment's `t`, or at its middle. */
  readonly insertPathNode: (ref: PathSegmentRef, at: 'point' | 'midpoint') => void;
  readonly deletePathSegment: (ref: PathSegmentRef) => void;
  /**
   * Live segment drag (LightBurn drag a line or curve): reshapes `original`
   * so its grabbed point moves by `localDelta`, without an undo step of its
   * own; the drag's interaction snapshot owns the history.
   */
  readonly reshapePathSegmentDuringInteraction: (
    ref: PathSegmentRef,
    original: CurveSubpath,
    localDelta: Vec2,
  ) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

const MIN_INSERT_T = 1e-6;

export function pathSegmentActions(set: Setter): PathSegmentActions {
  return {
    insertPathNode: (ref, at) =>
      set((state) => {
        const t =
          at === 'midpoint' ? 0.5 : Math.min(1 - MIN_INSERT_T, Math.max(MIN_INSERT_T, ref.t));
        return mutateObjectCurve(state, nodeRef(state, ref), (curves) => {
          const curve = curves[ref.curveIndex];
          const next = curve === undefined ? null : insertCurveNode(curve, ref.segmentIndex, t);
          return next === null ? null : replaceAt(curves, ref.curveIndex, [next]);
        });
      }),
    deletePathSegment: (ref) =>
      set((state) => {
        const target = nodeRef(state, ref);
        const path = refPath(state, ref);
        const closed =
          path?.curves?.[ref.curveIndex]?.closed ?? path?.polylines[ref.curveIndex]?.closed;
        return closed === true
          ? deleteClosedSegment(state, target, ref)
          : deleteOpenSegment(state, target, ref);
      }),
    reshapePathSegmentDuringInteraction: (ref, original, localDelta) =>
      set((state) => reshapeDuringInteraction(state, ref, original, localDelta)),
  };
}

function reshapeDuringInteraction(
  state: AppState,
  ref: PathSegmentRef,
  original: CurveSubpath,
  localDelta: Vec2,
): AppState | Partial<AppState> {
  const reshaped = dragCurveSegment(original, ref.segmentIndex, ref.t, localDelta);
  if (reshaped === null) return state;
  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    if (object.id !== ref.objectId || !isCurveCommandObject(object)) return object;
    const path = object.paths[ref.pathIndex];
    if (path === undefined) return object;
    const curves = [...(path.curves ?? path.polylines.map(polylineToCurveSubpath))];
    if (curves[ref.curveIndex] === undefined) return object;
    curves[ref.curveIndex] = reshaped;
    const nextPath = materializeCurves(path, curves);
    if (nextPath === null) return object;
    const paths = object.paths.map((candidate, index) =>
      index === ref.pathIndex ? nextPath : candidate,
    );
    const bounds = boundsForPaths(paths);
    const updated =
      object.kind === 'shape'
        ? synchronizePolylineShapeGeometry(object, paths, bounds)
        : { ...object, paths, bounds };
    if (updated === null) return object;
    changed = true;
    return updated;
  });
  if (!changed) return state;
  return { project: { ...state.project, scene: { ...state.project.scene, objects } }, dirty: true };
}

// On a closed contour, deleting a segment is Break at the node it ends on, so
// hand-placed tabs follow exactly as they do for Break.
function deleteClosedSegment(
  state: AppState,
  target: PathNodeRef,
  ref: PathSegmentRef,
): AppState | Partial<AppState> {
  let node = 0;
  return mutateObjectCurve(
    state,
    target,
    (curves) => {
      const curve = curves[ref.curveIndex];
      if (curve === undefined || ref.segmentIndex >= curveSegmentCount(curve)) return null;
      node = (ref.segmentIndex + 1) % curveNodeCount(curve);
      const next = breakCurveAtNode(curve, node);
      return next === null ? null : replaceAt(curves, ref.curveIndex, [next]);
    },
    (edited, _ref, before) => {
      const curve = before[ref.curveIndex];
      const cut = curve === undefined ? null : closedCurveBreak(curve, node);
      return cut === null
        ? edited
        : {
            ...edited,
            ...(edited.cncTabAnchors === undefined
              ? {}
              : {
                  cncTabAnchors: brokenTabAnchors(
                    edited.cncTabAnchors,
                    ref.pathIndex,
                    ref.curveIndex,
                    cut,
                  ),
                }),
            ...(edited.laserTabAnchors === undefined
              ? {}
              : {
                  laserTabAnchors: brokenTabAnchors(
                    edited.laserTabAnchors,
                    ref.pathIndex,
                    ref.curveIndex,
                    cut,
                  ),
                }),
          };
    },
  );
}

function deleteOpenSegment(
  state: AppState,
  target: PathNodeRef,
  ref: PathSegmentRef,
): AppState | Partial<AppState> {
  let added = 0;
  return mutateObjectCurve(
    state,
    target,
    (curves) => {
      const curve = curves[ref.curveIndex];
      const pieces = curve === undefined ? null : deleteCurveSegment(curve, ref.segmentIndex);
      if (pieces === null) return null;
      // Removing an object's last segment would leave nothing to edit: use Delete.
      if (pieces.length === 0 && curves.length === 1) return null;
      added = pieces.length - 1;
      return replaceAt(curves, ref.curveIndex, pieces);
    },
    (edited) => withShiftedContourTabs(edited, ref.pathIndex, ref.curveIndex, added),
  );
}

// The segment's start node, addressed the way the node tool addresses it:
// canonical curves by curve node, legacy outlines by polyline point.
function nodeRef(state: AppState, ref: PathSegmentRef): PathNodeRef {
  return {
    objectId: ref.objectId,
    pathIndex: ref.pathIndex,
    polylineIndex: ref.curveIndex,
    pointIndex: ref.segmentIndex,
    ...(refPath(state, ref)?.curves === undefined ? {} : { geometry: 'curve' as const }),
  };
}

function refPath(state: AppState, ref: PathSegmentRef): ColoredPath | undefined {
  const object = state.project.scene.objects.find((candidate) => candidate.id === ref.objectId);
  return object !== undefined && 'paths' in object ? object.paths[ref.pathIndex] : undefined;
}

function replaceAt<T>(
  items: ReadonlyArray<T>,
  index: number,
  replacement: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return [...items.slice(0, index), ...replacement, ...items.slice(index + 1)];
}
