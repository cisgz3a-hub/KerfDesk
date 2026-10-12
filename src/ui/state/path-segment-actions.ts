// Segment edits of the workspace node tool (LightBurn Edit Nodes): insert a
// node at a point on a segment or at its midpoint, and delete a segment. A
// segment is addressed by the contour that owns it, like a node is.

import {
  curveSegmentCount,
  deleteCurveSegment,
  insertCurveNode,
} from '../../core/geometry/curve-segment-edit';
import { breakCurveAtNode, curveNodeCount, type ColoredPath } from '../../core/scene';
import { closedCurveBreak, brokenTabAnchors } from '../../core/cnc/cnc-tab-anchors';
import type { PathNodeRef } from './path-node-edit-actions';
import { mutateObjectCurve, withShiftedContourTabs } from './path-node-curve-command-actions';
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
  };
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
