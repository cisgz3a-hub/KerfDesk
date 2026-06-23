import {
  type Bounds,
  type ColoredPath,
  type Polyline,
  type Project,
  type SceneObject,
  type ShapeObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import type { AppState } from './store';
import { pushUndo } from './scene-mutations';

export type PathNodeRef = {
  readonly objectId: string;
  readonly pathIndex: number;
  readonly polylineIndex: number;
  readonly pointIndex: number;
};

export type PathNodeEditActions = {
  readonly selectPathNode: (
    ref: PathNodeRef | null,
    options?: { readonly additive?: boolean },
  ) => void;
  readonly nudgeSelectedPathNode: (dx: number, dy: number) => void;
  readonly setSelectedPathNodePositionDuringInteraction: (scenePoint: Vec2) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function pathNodeEditActions(set: Setter): PathNodeEditActions {
  return {
    selectPathNode: (ref, options = {}) =>
      set((state) => selectPathNode(state, ref, options.additive === true)),
    nudgeSelectedPathNode: (dx, dy) => set((state) => nudgeSelectedPathNode(state, dx, dy)),
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

function setSelectedPathNodePositionDuringInteraction(
  state: AppState,
  scenePoint: Vec2,
): AppState | Partial<AppState> {
  const ref = state.selectedPathNode;
  if (ref === null || !Number.isFinite(scenePoint.x) || !Number.isFinite(scenePoint.y)) {
    return state;
  }

  let changed = false;
  const nextProject: Project = {
    ...state.project,
    scene: {
      ...state.project.scene,
      objects: state.project.scene.objects.map((object) => {
        if (object.id !== ref.objectId) return object;
        const localPoint = scenePointToObjectLocal(scenePoint, object.transform);
        if (localPoint === null) return object;
        const edited = editObjectNodeToPoint(object, ref, localPoint);
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
  if (object.kind === 'raster-image' || object.kind === 'text') return object;
  if (object.kind === 'shape' && object.spec.kind !== 'polyline') return object;

  const localDelta = sceneVectorToObjectLocal({ x: dx, y: dy }, object.transform);
  if (localDelta === null) return object;
  const edit = editPathsNodesByDelta(object.paths, refs, localDelta.x, localDelta.y);
  if (edit === null) return object;
  const bounds = boundsForPaths(edit.paths);
  if (object.kind === 'shape') return editPolylineShape(object, edit.paths, bounds);
  return { ...object, paths: edit.paths, bounds };
}

function editObjectNodeToPoint(object: SceneObject, ref: PathNodeRef, point: Vec2): SceneObject {
  if (object.locked === true) return object;
  if (object.kind === 'raster-image' || object.kind === 'text') return object;
  if (object.kind === 'shape' && object.spec.kind !== 'polyline') return object;

  const edit = editPathsNodeToPoint(object.paths, ref, point);
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
      points: nextPoints,
    },
  };
}

function editPathsNodesByDelta(
  paths: ReadonlyArray<ColoredPath>,
  refs: ReadonlyArray<PathNodeRef>,
  dx: number,
  dy: number,
): { readonly paths: ReadonlyArray<ColoredPath> } | null {
  let changed = false;
  const refKeys = new Set(refs.map(pathNodeRefKey));
  const nextPaths = paths.map((path, pathIndex) => ({
    ...path,
    polylines: path.polylines.map((polyline, polylineIndex) => ({
      ...polyline,
      points: polyline.points.map((point, pointIndex) => {
        if (!refKeys.has(pathNodeRefKey({ objectId: '', pathIndex, polylineIndex, pointIndex }))) {
          return point;
        }
        changed = true;
        const nextPoint = { x: point.x + dx, y: point.y + dy };
        return nextPoint;
      }),
    })),
  }));
  return changed ? { paths: nextPaths } : null;
}

function editPathsNodeToPoint(
  paths: ReadonlyArray<ColoredPath>,
  ref: PathNodeRef,
  nextPoint: Vec2,
): { readonly paths: ReadonlyArray<ColoredPath>; readonly point: Vec2 } | null {
  const path = paths[ref.pathIndex];
  const polyline = path?.polylines[ref.polylineIndex];
  const point = polyline?.points[ref.pointIndex];
  if (path === undefined || polyline === undefined || point === undefined) return null;
  if (pointsEqual(point, nextPoint)) return null;

  return {
    point: nextPoint,
    paths: paths.map((candidatePath, pathIndex) => {
      if (pathIndex !== ref.pathIndex) return candidatePath;
      return {
        ...candidatePath,
        polylines: candidatePath.polylines.map((candidatePolyline, polylineIndex) => {
          if (polylineIndex !== ref.polylineIndex) return candidatePolyline;
          return {
            ...candidatePolyline,
            points: candidatePolyline.points.map((candidatePoint, pointIndex) =>
              pointIndex === ref.pointIndex ? nextPoint : candidatePoint,
            ),
          };
        }),
      };
    }),
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

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
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

function pathNodeRefsEqual(a: PathNodeRef, b: PathNodeRef): boolean {
  return (
    a.objectId === b.objectId &&
    a.pathIndex === b.pathIndex &&
    a.polylineIndex === b.polylineIndex &&
    a.pointIndex === b.pointIndex
  );
}

function pathNodeRefKey(ref: Omit<PathNodeRef, 'objectId'> | PathNodeRef): string {
  return `${ref.pathIndex}:${ref.polylineIndex}:${ref.pointIndex}`;
}

function boundsForPaths(paths: ReadonlyArray<ColoredPath>): Bounds {
  const points = paths.flatMap((path) =>
    path.polylines.flatMap((polyline: Polyline) => polyline.points),
  );
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}
