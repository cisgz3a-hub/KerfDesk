import {
  breakCurveAtNode,
  convertCurveSegment,
  cornerCurveNode,
  flattenCurveSubpath,
  joinCurveSubpaths,
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

export type PathNodeCurveCommandActions = {
  readonly smoothSelectedCurveNode: () => void;
  readonly cornerSelectedCurveNode: () => void;
  readonly convertSelectedCurveSegment: (kind: 'line' | 'cubic') => void;
  readonly setSelectedCurveStart: () => void;
  readonly breakSelectedCurve: () => void;
  readonly joinSelectedCurveNodes: () => void;
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
    joinSelectedCurveNodes: () => set((state) => joinSelected(state)),
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

function joinSelected(state: AppState): AppState | Partial<AppState> {
  const refs = state.selectedPathNodes.filter(isAnchorRef);
  if (refs.length !== 2) return state;
  const [firstRef, secondRef] = refs;
  if (
    firstRef === undefined ||
    secondRef === undefined ||
    firstRef.objectId !== secondRef.objectId ||
    firstRef.pathIndex !== secondRef.pathIndex ||
    firstRef.polylineIndex === secondRef.polylineIndex
  ) {
    return state;
  }
  return mutateObjectCurve(state, firstRef, (curves) => {
    const first = curves[firstRef.polylineIndex];
    const second = curves[secondRef.polylineIndex];
    if (first === undefined || second === undefined) return null;
    const joined = joinCurveSubpaths(first, second);
    if (joined === null) return null;
    return curves
      .map((curve, index) => (index === firstRef.polylineIndex ? joined : curve))
      .filter((_curve, index) => index !== secondRef.polylineIndex);
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
    changed = true;
    return { ...object, paths, bounds: boundsForPaths(paths) };
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
  return object.kind === 'imported-svg' || object.kind === 'traced-image';
}
