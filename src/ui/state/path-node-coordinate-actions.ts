import { applyTransform, type SceneObject, type Vec2 } from '../../core/scene';
import { pathNodePoint } from './path-node-edit-geometry';
import type { PathNodeRef } from './path-node-edit-actions';
import { pushUndo } from './scene-mutations';
import type { AppState } from './store';

export type NodeAxis = 'x' | 'y';
export type NodeAlignment = 'min' | 'center' | 'max';
export type PathNodeCoordinateActions = {
  readonly setSelectedPathNodeCoordinate: (axis: NodeAxis, value: number) => void;
  readonly alignSelectedPathNodes: (axis: NodeAxis, alignment: NodeAlignment) => void;
};
type EditTarget = (
  object: SceneObject,
  primary: PathNodeRef,
  refs: ReadonlyArray<PathNodeRef>,
  target: Vec2,
) => SceneObject;
type Setter = (update: (state: AppState) => AppState | Partial<AppState>) => void;

/** Coordinates shown and entered are always in the workspace's millimetres. */
export function nodeScenePoint(object: SceneObject | undefined, ref: PathNodeRef): Vec2 | null {
  if (object === undefined || !('paths' in object) || object.locked === true) return null;
  const point = pathNodePoint(object.paths, ref);
  if (point === null) return null;
  const world = applyTransform(point, object.transform);
  return Number.isFinite(world.x) && Number.isFinite(world.y) ? world : null;
}

export function pathNodeCoordinateActions(
  set: Setter,
  editTarget: EditTarget,
): PathNodeCoordinateActions {
  return {
    setSelectedPathNodeCoordinate: (axis, value) =>
      set((state) => {
        const ref = state.selectedPathNode;
        if (ref === null || !Number.isFinite(value)) return state;
        const object = state.project.scene.objects.find((entry) => entry.id === ref.objectId);
        const point = nodeScenePoint(object, ref);
        if (object === undefined || point === null || point[axis] === value) return state;
        const refs = state.selectedPathNodes.length > 0 ? state.selectedPathNodes : [ref];
        return replaced(
          state,
          object,
          editTarget(object, ref, refs, { ...point, [axis]: value }),
          'Move nodes',
        );
      }),
    alignSelectedPathNodes: (axis, alignment) =>
      set((state) => {
        const refs = state.selectedPathNodes.filter((ref) => ref.handle === undefined);
        if (refs.length < 2) return state;
        const object = state.project.scene.objects.find((entry) => entry.id === refs[0]?.objectId);
        if (object === undefined || refs.some((ref) => ref.objectId !== object.id)) return state;
        const points = refs.map((ref) => nodeScenePoint(object, ref));
        if (points.some((point) => point === null)) return state;
        const coordinates = points.flatMap((point) => (point === null ? [] : [point[axis]]));
        const min = coordinates.reduce((value, next) => Math.min(value, next), Infinity);
        const max = coordinates.reduce((value, next) => Math.max(value, next), -Infinity);
        const target =
          alignment === 'min' ? min : alignment === 'max' ? max : min + (max - min) / 2;
        if (!Number.isFinite(target) || min === max) return state;
        let edited = object;
        refs.forEach((ref, index) => {
          const point = points[index];
          if (point !== null && point !== undefined && point[axis] !== target)
            edited = editTarget(edited, ref, [ref], { ...point, [axis]: target });
        });
        return replaced(state, object, edited, 'Align nodes');
      }),
  };
}

function replaced(
  state: AppState,
  original: SceneObject,
  edited: SceneObject,
  label: string,
): AppState | Partial<AppState> {
  if (edited === original) return state;
  return {
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: state.project.scene.objects.map((object) =>
          object === original ? edited : object,
        ),
      },
    },
    undoStack: pushUndo(state.project, state.undoStack, label),
    redoStack: [],
    dirty: true,
  };
}
