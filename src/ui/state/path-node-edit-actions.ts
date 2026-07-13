import {
  type Bounds,
  type ColoredPath,
  type Project,
  type SceneObject,
  type ShapeObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';
import {
  boundsForPaths,
  deletePathsNodes,
  editPathsNodesByDelta,
  materializedPolylineToSpecPoints,
  pathNodePoint,
} from './path-node-edit-geometry';

export type PathNodeRef = {
  readonly objectId: string;
  readonly pathIndex: number;
  readonly polylineIndex: number;
  readonly pointIndex: number;
  readonly geometry?: 'curve';
  readonly handle?: 'incoming' | 'outgoing';
};

export type PathNodeEditActions = {
  readonly selectPathNode: (
    ref: PathNodeRef | null,
    options?: { readonly additive?: boolean },
  ) => void;
  readonly nudgeSelectedPathNode: (dx: number, dy: number) => void;
  readonly deleteSelectedPathNodes: () => void;
  readonly setSelectedPathNodePositionDuringInteraction: (scenePoint: Vec2) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function pathNodeEditActions(set: Setter): PathNodeEditActions {
  return {
    selectPathNode: (ref, options = {}) =>
      set((state) => selectPathNode(state, ref, options.additive === true)),
    nudgeSelectedPathNode: (dx, dy) => set((state) => nudgeSelectedPathNode(state, dx, dy)),
    deleteSelectedPathNodes: () => set((state) => deleteSelectedPathNodes(state)),
    setSelectedPathNodePositionDuringInteraction: (scenePoint) =>
      set((state) => setSelectedPathNodePositionDuringInteraction(state, scenePoint)),
  };
}

function selectPathNode(
  state: AppState,
  ref: PathNodeRef | null,
  additive: boolean,
): AppState | Partial<AppState> {
  if (ref === null) return { selectedPathNode: null, selectedPathNodes: [] };
  if (!additive || state.selectedPathNodes.length === 0) {
    return singlePathNodeSelection(ref);
  }
  const sameObject = state.selectedPathNodes.every(
    (selected) => selected.objectId === ref.objectId,
  );
  if (!sameObject) return singlePathNodeSelection(ref);

  const exists = state.selectedPathNodes.some((selected) => pathNodeRefsEqual(selected, ref));
  const selectedPathNodes = exists
    ? state.selectedPathNodes.filter((selected) => !pathNodeRefsEqual(selected, ref))
    : [...state.selectedPathNodes, ref];
  return {
    selectedPathNode: selectedPathNodes[selectedPathNodes.length - 1] ?? null,
    selectedPathNodes,
    selectedObjectId: ref.objectId,
    additionalSelectedIds: new Set(),
  };
}

function singlePathNodeSelection(ref: PathNodeRef): Partial<AppState> {
  return {
    selectedPathNode: ref,
    selectedPathNodes: [ref],
    selectedObjectId: ref.objectId,
    additionalSelectedIds: new Set(),
  };
}

function nudgeSelectedPathNode(
  state: AppState,
  dx: number,
  dy: number,
): AppState | Partial<AppState> {
  const refs = activePathNodeRefs(state);
  if (refs.length === 0 || !Number.isFinite(dx) || !Number.isFinite(dy)) return state;
  if (dx === 0 && dy === 0) return state;
  const refsByObject = groupPathNodeRefsByObject(refs);

  let changed = false;
  const nextProject: Project = {
    ...state.project,
    scene: {
      ...state.project.scene,
      objects: state.project.scene.objects.map((object) => {
        const objectRefs = refsByObject.get(object.id);
        if (objectRefs === undefined) return object;
        const edited = editObjectNodes(object, objectRefs, dx, dy);
        if (edited === object) return object;
        changed = true;
        return edited;
      }),
    },
  };
  if (!changed) return state;
  return {
    project: nextProject,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function deleteSelectedPathNodes(state: AppState): AppState | Partial<AppState> {
  const refs = activePathNodeRefs(state);
  if (refs.length === 0) return state;
  const refsByObject = groupPathNodeRefsByObject(refs);

  let changed = false;
  const nextProject: Project = {
    ...state.project,
    scene: {
      ...state.project.scene,
      objects: state.project.scene.objects.map((object) => {
        const objectRefs = refsByObject.get(object.id);
        if (objectRefs === undefined) return object;
        const edited = deleteObjectNodes(object, objectRefs);
        if (edited === object) return object;
        changed = true;
        return edited;
      }),
    },
  };
  if (!changed) return state;
  return {
    project: nextProject,
    selectedPathNode: null,
    selectedPathNodes: [],
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

// Drag the whole selected-node set (audit C6): move the primary node under the
// pointer and every other selected node by the same local delta. All selected
// nodes are guaranteed to be in one object (the selection invariant), so a
// single local delta applies to the whole set.
function setSelectedPathNodePositionDuringInteraction(
  state: AppState,
  scenePoint: Vec2,
): AppState | Partial<AppState> {
  const ref = state.selectedPathNode;
  if (ref === null || !Number.isFinite(scenePoint.x) || !Number.isFinite(scenePoint.y)) {
    return state;
  }
  const refs = activePathNodeRefs(state);

  let changed = false;
  const nextProject: Project = {
    ...state.project,
    scene: {
      ...state.project.scene,
      objects: state.project.scene.objects.map((object) => {
        if (object.id !== ref.objectId) return object;
        const edited = dragObjectNodesToPrimaryTarget(object, ref, refs, scenePoint);
        if (edited === object) return object;
        changed = true;
        return edited;
      }),
    },
  };
  return changed ? { project: nextProject, dirty: true } : state;
}

function editObjectNodes(
  object: SceneObject,
  refs: ReadonlyArray<PathNodeRef>,
  dx: number,
  dy: number,
): SceneObject {
  if (object.locked === true) return object;
  if (object.kind === 'raster-image' || object.kind === 'relief' || object.kind === 'text') {
    return object;
  }
  if (object.kind === 'shape' && object.spec.kind !== 'polyline') return object;

  const localDelta = sceneVectorToObjectLocal({ x: dx, y: dy }, object.transform);
  if (localDelta === null) return object;
  const edit = editPathsNodesByDelta(object.paths, refs, localDelta.x, localDelta.y);
  if (edit === null) return object;
  const bounds = boundsForPaths(edit.paths);
  if (object.kind === 'shape') return editPolylineShape(object, edit.paths, bounds);
  return { ...object, paths: edit.paths, bounds };
}

function deleteObjectNodes(object: SceneObject, refs: ReadonlyArray<PathNodeRef>): SceneObject {
  if (object.locked === true) return object;
  if (object.kind === 'raster-image' || object.kind === 'relief' || object.kind === 'text') {
    return object;
  }
  if (object.kind === 'shape' && object.spec.kind !== 'polyline') return object;

  const edit = deletePathsNodes(object.paths, refs);
  if (edit === null) return object;
  const bounds = boundsForPaths(edit.paths);
  if (object.kind === 'shape') return editPolylineShape(object, edit.paths, bounds);
  return { ...object, paths: edit.paths, bounds };
}

// Move `primaryRef` to `scenePoint` and every ref in `refs` by the same local
// delta, keeping the selected nodes' relative shape intact while the primary
// tracks the pointer (audit C6).
function dragObjectNodesToPrimaryTarget(
  object: SceneObject,
  primaryRef: PathNodeRef,
  refs: ReadonlyArray<PathNodeRef>,
  scenePoint: Vec2,
): SceneObject {
  if (object.locked === true) return object;
  if (object.kind === 'raster-image' || object.kind === 'relief' || object.kind === 'text') {
    return object;
  }
  if (object.kind === 'shape' && object.spec.kind !== 'polyline') return object;

  const target = scenePointToObjectLocal(scenePoint, object.transform);
  const current = pathNodePoint(object.paths, primaryRef);
  if (target === null || current === null) return object;
  const edit = editPathsNodesByDelta(
    object.paths,
    refs,
    target.x - current.x,
    target.y - current.y,
  );
  if (edit === null) return object;
  const bounds = boundsForPaths(edit.paths);
  if (object.kind === 'shape') return editPolylineShape(object, edit.paths, bounds);
  return { ...object, paths: edit.paths, bounds };
}

function editPolylineShape(
  object: ShapeObject,
  paths: ReadonlyArray<ColoredPath>,
  bounds: Bounds,
): ShapeObject {
  if (object.spec.kind !== 'polyline') return object;
  const nextPoints = paths[0]?.polylines[0]?.points ?? object.spec.points;
  return {
    ...object,
    paths,
    bounds,
    spec: {
      ...object.spec,
      points: materializedPolylineToSpecPoints(nextPoints, object.spec.closed),
    },
  };
}

function scenePointToObjectLocal(point: Vec2, transform: Transform): Vec2 | null {
  if (!isInvertibleScale(transform.scaleX) || !isInvertibleScale(transform.scaleY)) return null;
  const dx = point.x - transform.x;
  const dy = point.y - transform.y;
  return sceneVectorToObjectLocal({ x: dx, y: dy }, transform);
}

function sceneVectorToObjectLocal(vector: Vec2, transform: Transform): Vec2 | null {
  if (!isInvertibleScale(transform.scaleX) || !isInvertibleScale(transform.scaleY)) return null;
  const rad = (transform.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let x = vector.x * cos + vector.y * sin;
  let y = -vector.x * sin + vector.y * cos;
  if (transform.mirrorX) x = -x;
  if (transform.mirrorY) y = -y;
  return { x: x / transform.scaleX, y: y / transform.scaleY };
}

function isInvertibleScale(value: number): boolean {
  return Number.isFinite(value) && value !== 0;
}

function activePathNodeRefs(state: AppState): ReadonlyArray<PathNodeRef> {
  if (state.selectedPathNodes.length > 0) return state.selectedPathNodes;
  return state.selectedPathNode === null ? [] : [state.selectedPathNode];
}

function groupPathNodeRefsByObject(
  refs: ReadonlyArray<PathNodeRef>,
): ReadonlyMap<string, ReadonlyArray<PathNodeRef>> {
  const byObject = new Map<string, PathNodeRef[]>();
  for (const ref of refs) {
    const current = byObject.get(ref.objectId) ?? [];
    current.push(ref);
    byObject.set(ref.objectId, current);
  }
  return byObject;
}

export function pathNodeRefsEqual(a: PathNodeRef, b: PathNodeRef): boolean {
  return (
    a.objectId === b.objectId &&
    a.pathIndex === b.pathIndex &&
    a.polylineIndex === b.polylineIndex &&
    a.pointIndex === b.pointIndex &&
    a.geometry === b.geometry &&
    a.handle === b.handle
  );
}
