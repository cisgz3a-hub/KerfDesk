import {
  addLayer,
  appendSceneObjectOperationBinding,
  artworkOperationName,
  bindSceneObjectToOperations,
  createArtworkOperation,
  nextOperationColor,
  primaryOperationForObject,
  replaceSceneObjectOperationBinding,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { canonicalArtworkOrder } from '../../core/artwork-order';
import { pruneOrphanLayers, pushUndo, type StateSlice } from './scene-mutations';

type OperationActionState = StateSlice & {
  readonly selectedObjectId: string | null;
  readonly additionalSelectedIds: ReadonlySet<string>;
};

type OperationMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: ReadonlyArray<Project>;
  readonly dirty: true;
};

type OperationSet = (
  fn: (state: OperationActionState) => OperationMutation | Record<string, never>,
) => void;

export type OperationActions = {
  readonly useOperationForSelection: (operationId: string) => void;
  readonly makeSelectedOperationUnique: (operationId: string) => void;
  readonly addOperationForSelection: () => void;
  readonly renameOperation: (operationId: string, name: string) => void;
  readonly moveSelectedArtwork: (direction: ArtworkMoveDirection) => void;
};

export type ArtworkMoveDirection = 'first' | 'earlier' | 'later' | 'last';

export function operationActions(set: OperationSet): OperationActions {
  return {
    useOperationForSelection: (operationId) => set((state) => rebindSelection(state, operationId)),
    makeSelectedOperationUnique: (operationId) =>
      set((state) => cloneOperationForSelection(state, operationId, false)),
    addOperationForSelection: () =>
      set((state) => {
        const selected = selectedObjects(state);
        const primary = selected[0];
        if (primary === undefined) return {};
        const source = primaryOperationForObject(primary, state.project.scene.layers);
        if (source === null) return {};
        return cloneOperationForSelection(state, source.id, true);
      }),
    renameOperation: (operationId, name) =>
      set((state) => {
        const trimmed = name.trim();
        if (trimmed.length === 0) return {};
        const nextName = uniqueOperationName(state.project.scene.layers, operationId, trimmed);
        let changed = false;
        const layers = state.project.scene.layers.map((layer) => {
          if (layer.id !== operationId || layer.name === nextName) return layer;
          changed = true;
          return { ...layer, name: nextName };
        });
        return changed
          ? mutation(state, { ...state.project, scene: { ...state.project.scene, layers } })
          : {};
      }),
    moveSelectedArtwork: (direction) =>
      set((state) => {
        const selectedIds = selectedIdSet(state);
        if (selectedIds.size === 0) return {};
        const current = canonicalArtworkOrder(state.project.scene);
        const next = moveArtworkIds(current, selectedIds, direction);
        if (sameStringArray(current, next)) return {};
        return mutation(state, {
          ...state.project,
          scene: { ...state.project.scene, artworkOrder: next },
        });
      }),
  };
}

function moveArtworkIds(
  current: ReadonlyArray<string>,
  selected: ReadonlySet<string>,
  direction: ArtworkMoveDirection,
): ReadonlyArray<string> {
  if (direction === 'first') return moveArtworkToEdge(current, selected, true);
  if (direction === 'last') return moveArtworkToEdge(current, selected, false);
  return moveArtworkOneStep(current, selected, direction);
}

function moveArtworkToEdge(
  current: ReadonlyArray<string>,
  selected: ReadonlySet<string>,
  first: boolean,
): ReadonlyArray<string> {
  const moving = current.filter((id) => selected.has(id));
  const remaining = current.filter((id) => !selected.has(id));
  return first ? [...moving, ...remaining] : [...remaining, ...moving];
}

function moveArtworkOneStep(
  current: ReadonlyArray<string>,
  selected: ReadonlySet<string>,
  direction: 'earlier' | 'later',
): ReadonlyArray<string> {
  const next = [...current];
  if (direction === 'earlier') {
    for (let index = 1; index < next.length; index += 1) {
      const id = next[index];
      const previous = next[index - 1];
      if (
        id !== undefined &&
        previous !== undefined &&
        selected.has(id) &&
        !selected.has(previous)
      ) {
        next[index - 1] = id;
        next[index] = previous;
      }
    }
    return next;
  }
  for (let index = next.length - 2; index >= 0; index -= 1) {
    const id = next[index];
    const following = next[index + 1];
    if (
      id !== undefined &&
      following !== undefined &&
      selected.has(id) &&
      !selected.has(following)
    ) {
      next[index] = following;
      next[index + 1] = id;
    }
  }
  return next;
}

function rebindSelection(
  state: OperationActionState,
  operationId: string,
): OperationMutation | Record<string, never> {
  if (!state.project.scene.layers.some((operation) => operation.id === operationId)) return {};
  const selectedIds = selectedIdSet(state);
  if (selectedIds.size === 0) return {};
  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    if (!selectedIds.has(object.id)) return object;
    const next = bindSceneObjectToOperations(clearOperationOverride(object), [operationId]);
    if (sameOperationIds(object.operationIds, next.operationIds)) return object;
    changed = true;
    return next;
  });
  if (!changed) return {};
  const scene = pruneOrphanLayers({ ...state.project.scene, objects });
  return mutation(state, { ...state.project, scene });
}

function cloneOperationForSelection(
  state: OperationActionState,
  operationId: string,
  additive: boolean,
): OperationMutation | Record<string, never> {
  const source = state.project.scene.layers.find((layer) => layer.id === operationId);
  const selected = selectedObjects(state);
  const first = selected[0];
  if (source === undefined || first === undefined) return {};
  const seed = createArtworkOperation(state.project.scene, first, {
    name: additive ? `${source.name} 2` : artworkOperationName(first),
  });
  const operation: Layer = {
    ...source,
    id: seed.operation.id,
    name: seed.operation.name,
    color: nextOperationColor(state.project.scene.layers),
    subLayers: [],
  };
  const selectedIds = selectedIdSet(state);
  const objects = state.project.scene.objects.map((object) => {
    if (!selectedIds.has(object.id)) return object;
    const clean = clearOperationOverride(object);
    return additive
      ? appendSceneObjectOperationBinding(clean, operation.id, state.project.scene.layers)
      : replaceSceneObjectOperationBinding(
          clean,
          operationId,
          operation.id,
          state.project.scene.layers,
        );
  });
  const scene = addLayer({ ...state.project.scene, objects }, operation);
  return mutation(state, { ...state.project, scene });
}

function selectedObjects(state: OperationActionState): ReadonlyArray<SceneObject> {
  const ids = selectedIdSet(state);
  return state.project.scene.objects.filter((object) => ids.has(object.id));
}

function selectedIdSet(state: OperationActionState): ReadonlySet<string> {
  return new Set([
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ]);
}

function clearOperationOverride(object: SceneObject): SceneObject {
  if (object.operationOverride === undefined) return object;
  const { operationOverride: _operationOverride, ...rest } = object;
  return rest as SceneObject;
}

function sameOperationIds(
  left: ReadonlyArray<string> | undefined,
  right: ReadonlyArray<string> | undefined,
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function sameStringArray(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueOperationName(
  operations: ReadonlyArray<Layer>,
  operationId: string,
  requested: string,
): string {
  const used = new Set(
    operations
      .filter((operation) => operation.id !== operationId)
      .map((operation) => operation.name.toLocaleLowerCase()),
  );
  if (!used.has(requested.toLocaleLowerCase())) return requested;
  let suffix = 2;
  while (used.has(`${requested} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${requested} ${suffix}`;
}

function mutation(state: OperationActionState, project: Project): OperationMutation {
  return {
    project,
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}
