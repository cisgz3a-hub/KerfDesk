import {
  breakCurveAtNode,
  convertCurveSegment,
  cornerCurveNode,
  flattenCurveSubpath,
  setCurveStartNode,
  smoothCurveNode,
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
    setSelectedCurveStart: () => set((state) => mutateSelected(state, setCurveStartNode)),
    breakSelectedCurve: () => set((state) => mutateSelected(state, breakCurveAtNode)),
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

function mutateSelected(
  state: AppState,
  mutate: (curve: CurveSubpath, nodeIndex: number) => CurveSubpath | null,
): AppState | Partial<AppState> {
  const ref = state.selectedPathNode;
  if (!isAnchorRef(ref)) return state;
  return mutateObjectCurve(state, ref, (curves) => {
    const curve = curves[ref.polylineIndex];
    if (curve === undefined) return null;
    const next = mutate(curve, ref.pointIndex);
    if (next === null || next === curve) return null;
    const updated = [...curves];
    updated[ref.polylineIndex] = next;
    return updated;
  });
}

function mutateObjectCurve(
  state: AppState,
  ref: PathNodeRef,
  mutate: (curves: ReadonlyArray<CurveSubpath>) => ReadonlyArray<CurveSubpath> | null,
): AppState | Partial<AppState> {
  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    if (object.id !== ref.objectId || !isCurveCommandObject(object)) return object;
    const path = object.paths[ref.pathIndex];
    if (path?.curves === undefined) return object;
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
    return updated;
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

function isAnchorRef(ref: PathNodeRef | null): ref is PathNodeRef & { geometry: 'curve' } {
  return ref?.geometry === 'curve' && ref.handle === undefined;
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
