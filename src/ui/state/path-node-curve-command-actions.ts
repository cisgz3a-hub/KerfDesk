import {
  brokenTabAnchors,
  closedCurveBreak,
  closedCurveNodeFraction,
  restartedTabAnchors,
} from '../../core/cnc/cnc-tab-anchors';
import {
  breakCurveAtNode,
  convertCurveSegment,
  cornerCurveNode,
  flattenCurveSubpath,
  setCurveStartNode,
  smoothCurveNode,
  type CncTabAnchor,
  type ColoredPath,
  type CurveSubpath,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import { boundsForPaths } from './path-node-edit-geometry';
import type { PathNodeRef } from './path-node-edit-actions';
import { planCurveNodeJoin } from './path-node-curve-join-plan';
import { curveCommandPath } from './path-node-command-geometry';
import { synchronizePolylineShapeGeometry } from './path-node-shape-sync';
import { useToastStore } from './toast-store';

type CurveJoinCommandOutcome =
  | { readonly kind: 'joined' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'unchanged' };

export type PathNodeCurveCommandActions = {
  readonly smoothSelectedCurveNode: () => void;
  readonly cornerSelectedCurveNode: () => void;
  readonly convertSelectedCurveSegment: (kind: 'line' | 'cubic') => void;
  readonly setSelectedCurveStart: () => void;
  readonly breakSelectedCurve: () => void;
  readonly joinSelectedCurveNodes: () => CurveJoinCommandOutcome;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function pathNodeCurveCommandActions(set: Setter): PathNodeCurveCommandActions {
  return {
    smoothSelectedCurveNode: () => set((state) => mutateSelected(state, smoothCurveNode)),
    cornerSelectedCurveNode: () => set((state) => mutateSelected(state, cornerCurveNode)),
    convertSelectedCurveSegment: (kind) =>
      set((state) =>
        mutateSelected(state, (curve, nodeIndex) => convertCurveSegment(curve, nodeIndex, kind)),
      ),
    setSelectedCurveStart: () =>
      set((state) => mutateSelected(state, setCurveStartNode, withRestartedTabs)),
    breakSelectedCurve: () =>
      set((state) => mutateSelected(state, breakCurveAtNode, withBrokenTabs)),
    joinSelectedCurveNodes: () => {
      let outcome: CurveJoinCommandOutcome = { kind: 'unchanged' };
      const notification = { present: false, text: '', success: false };
      set((state) => {
        const plan = planCurveNodeJoin(state.project, state.selectedPathNodes.filter(isAnchorRef));
        if (plan.kind === 'unchanged') {
          notification.present = true;
          notification.text = plan.message;
          return state;
        }
        outcome = { kind: plan.outcome };
        notification.present = true;
        notification.text = plan.message;
        notification.success = true;
        const objects = state.project.scene.objects.map((object) =>
          object.id === plan.object.id ? plan.object : object,
        );
        return {
          project: { ...state.project, scene: { ...state.project.scene, objects } },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
          selectedPathNode: null,
          selectedPathNodes: [],
        };
      });
      if (notification.present) {
        useToastStore
          .getState()
          .pushToast(notification.text, notification.success ? 'success' : 'warning');
      }
      return outcome;
    },
  };
}

// Keeps an edited object's tabs placed by hand in place, given the edited
// path's curves before the edit.
type TabFollow = (
  edited: SceneObject,
  ref: PathNodeRef,
  curvesBefore: ReadonlyArray<CurveSubpath>,
) => SceneObject;

function mutateSelected(
  state: AppState,
  mutate: (curve: CurveSubpath, nodeIndex: number) => CurveSubpath | null,
  followTabs?: TabFollow,
): AppState | Partial<AppState> {
  const ref = state.selectedPathNode;
  if (!isAnchorRef(ref)) return state;
  return mutateObjectCurve(
    state,
    ref,
    (curves) => {
      const curve = curves[ref.polylineIndex];
      if (curve === undefined) return null;
      const next = mutate(curve, ref.pointIndex);
      if (next === null || next === curve) return null;
      const updated = [...curves];
      updated[ref.polylineIndex] = next;
      return updated;
    },
    followTabs,
  );
}

// Start redraws a closed contour from the selected node. A tab placed by hand,
// CNC or laser, is a fraction of its contour from the start, so each one on
// that contour moves back by the node's fraction and stays where it was
// (ADR-494 Amendment 1).
function withRestartedTabs(
  edited: SceneObject,
  ref: PathNodeRef,
  curvesBefore: ReadonlyArray<CurveSubpath>,
): SceneObject {
  const curve = curvesBefore[ref.polylineIndex];
  const fraction = curve === undefined ? null : closedCurveNodeFraction(curve, ref.pointIndex);
  if (fraction === null || fraction === 0) return edited;
  return withFollowedTabs(edited, (anchors) =>
    restartedTabAnchors(anchors, ref.pathIndex, ref.polylineIndex, fraction),
  );
}

// Break opens a closed contour at the selected node and drops the segment that
// arrived there. The open contour holds no tab until a straight line closes it
// again, so its tabs are measured from the node along it and that line: Close
// Path puts every tab on the kept outline back where it was, and a tab on the
// dropped segment on the same share of the line (ADR-494 Amendment 1).
function withBrokenTabs(
  edited: SceneObject,
  ref: PathNodeRef,
  curvesBefore: ReadonlyArray<CurveSubpath>,
): SceneObject {
  const curve = curvesBefore[ref.polylineIndex];
  const cut = curve === undefined ? null : closedCurveBreak(curve, ref.pointIndex);
  if (cut === null) return edited;
  return withFollowedTabs(edited, (anchors) =>
    brokenTabAnchors(anchors, ref.pathIndex, ref.polylineIndex, cut),
  );
}

function withFollowedTabs(
  edited: SceneObject,
  follow: <A extends CncTabAnchor>(anchors: ReadonlyArray<A>) => ReadonlyArray<A>,
): SceneObject {
  if (edited.cncTabAnchors === undefined && edited.laserTabAnchors === undefined) return edited;
  return {
    ...edited,
    ...(edited.cncTabAnchors === undefined ? {} : { cncTabAnchors: follow(edited.cncTabAnchors) }),
    ...(edited.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: follow(edited.laserTabAnchors) }),
  };
}

function mutateObjectCurve(
  state: AppState,
  ref: PathNodeRef,
  mutate: (curves: ReadonlyArray<CurveSubpath>) => ReadonlyArray<CurveSubpath> | null,
  followTabs?: TabFollow,
): AppState | Partial<AppState> {
  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    if (object.id !== ref.objectId || !isCurveCommandObject(object)) return object;
    const source = object.paths[ref.pathIndex];
    if (source === undefined) return object;
    const path = curveCommandPath(source, [ref]);
    if (path === null) return object;
    const curves = mutate(path.curves);
    if (curves === null) return object;
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
    return followTabs === undefined ? updated : followTabs(updated, ref, path.curves);
  });
  if (!changed) return state;
  const project: Project = { ...state.project, scene: { ...state.project.scene, objects } };
  return {
    project,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
    selectedPathNode: null,
    selectedPathNodes: [],
  };
}

function materializeCurves(
  path: ColoredPath,
  curves: ReadonlyArray<CurveSubpath>,
): ColoredPath | null {
  const polylines = [];
  for (const curve of curves) {
    const result = flattenCurveSubpath(curve, { toleranceMm: 0.05 });
    if (result.kind !== 'ok') return null;
    polylines.push(result.polyline);
  }
  return { ...path, curves, polylines };
}

function isAnchorRef(ref: PathNodeRef | null): ref is PathNodeRef {
  return ref !== null && ref.handle === undefined;
}

function isCurveCommandObject(
  object: SceneObject,
): object is Extract<SceneObject, { readonly paths: ReadonlyArray<ColoredPath> }> {
  return (
    object.kind === 'imported-svg' ||
    object.kind === 'traced-image' ||
    (object.kind === 'shape' && object.spec.kind === 'polyline')
  );
}
