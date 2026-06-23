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
  readonly selectPathNode: (ref: PathNodeRef | null) => void;
  readonly nudgeSelectedPathNode: (dx: number, dy: number) => void;
  readonly setSelectedPathNodePositionDuringInteraction: (scenePoint: Vec2) => void;
};

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function pathNodeEditActions(set: Setter): PathNodeEditActions {
  return {
    selectPathNode: (ref) =>
      set(() =>
        ref === null
          ? { selectedPathNode: null }
          : {
              selectedPathNode: ref,
              selectedObjectId: ref.objectId,
              additionalSelectedIds: new Set(),
            },
      ),
    nudgeSelectedPathNode: (dx, dy) => set((state) => nudgeSelectedPathNode(state, dx, dy)),
    setSelectedPathNodePositionDuringInteraction: (scenePoint) =>
      set((state) => setSelectedPathNodePositionDuringInteraction(state, scenePoint)),
  };
}

function nudgeSelectedPathNode(
  state: AppState,
  dx: number,
  dy: number,
): AppState | Partial<AppState> {
  const ref = state.selectedPathNode;
  if (ref === null || !Number.isFinite(dx) || !Number.isFinite(dy)) return state;
  if (dx === 0 && dy === 0) return state;

  let changed = false;
  const nextProject: Project = {
    ...state.project,
    scene: {
      ...state.project.scene,
      objects: state.project.scene.objects.map((object) => {
        if (object.id !== ref.objectId) return object;
        const edited = editObjectNode(object, ref, dx, dy);
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

function editObjectNode(
  object: SceneObject,
  ref: PathNodeRef,
  dx: number,
  dy: number,
): SceneObject {
  if (object.locked === true) return object;
  if (object.kind === 'raster-image' || object.kind === 'text') return object;
  if (object.kind === 'shape' && object.spec.kind !== 'polyline') return object;

  const localDelta = sceneVectorToObjectLocal({ x: dx, y: dy }, object.transform);
  if (localDelta === null) return object;
  const edit = editPathsNodeByDelta(object.paths, ref, localDelta.x, localDelta.y);
  if (edit === null) return object;
  const bounds = boundsForPaths(edit.paths);
  if (object.kind === 'shape')
    return editPolylineShape(object, edit.paths, ref, edit.point, bounds);
  return { ...object, paths: edit.paths, bounds };
}

function editObjectNodeToPoint(object: SceneObject, ref: PathNodeRef, point: Vec2): SceneObject {
  if (object.locked === true) return object;
  if (object.kind === 'raster-image' || object.kind === 'text') return object;
  if (object.kind === 'shape' && object.spec.kind !== 'polyline') return object;

  const edit = editPathsNodeToPoint(object.paths, ref, point);
  if (edit === null) return object;
  const bounds = boundsForPaths(edit.paths);
  if (object.kind === 'shape')
    return editPolylineShape(object, edit.paths, ref, edit.point, bounds);
  return { ...object, paths: edit.paths, bounds };
}

function editPolylineShape(
  object: ShapeObject,
  paths: ReadonlyArray<ColoredPath>,
  ref: PathNodeRef,
  point: Vec2,
  bounds: Bounds,
): ShapeObject {
  if (object.spec.kind !== 'polyline') return object;
  return {
    ...object,
    paths,
    bounds,
    spec: {
      ...object.spec,
      points: object.spec.points.map((candidate, index) =>
        index === ref.pointIndex ? point : candidate,
      ),
    },
  };
}

function editPathsNodeByDelta(
  paths: ReadonlyArray<ColoredPath>,
  ref: PathNodeRef,
  dx: number,
  dy: number,
): { readonly paths: ReadonlyArray<ColoredPath>; readonly point: Vec2 } | null {
  const path = paths[ref.pathIndex];
  const polyline = path?.polylines[ref.polylineIndex];
  const point = polyline?.points[ref.pointIndex];
  if (path === undefined || polyline === undefined || point === undefined) return null;

  return editPathsNodeToPoint(paths, ref, { x: point.x + dx, y: point.y + dy });
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
