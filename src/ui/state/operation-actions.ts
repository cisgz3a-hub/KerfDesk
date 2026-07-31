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
  readonly useOperationForObjects: (objectIds: ReadonlyArray<string>, operationId: string) => void;
  readonly makeSelectedOperationUnique: (operationId: string) => void;
  readonly makeOperationUniqueForObjects: (
    objectIds: ReadonlyArray<string>,
    operationId: string,
  ) => void;
  readonly addOperationForSelection: () => void;
  readonly addOperationForObjects: (objectIds: ReadonlyArray<string>) => void;
  readonly renameOperation: (operationId: string, name: string) => void;
};

export function operationActions(set: OperationSet): OperationActions {
  return {
    useOperationForSelection: (operationId) =>
      set((state) => rebindObjects(state, selectedIdSet(state), operationId)),
    useOperationForObjects: (objectIds, operationId) =>
      set((state) => rebindObjects(state, new Set(objectIds), operationId)),
    makeSelectedOperationUnique: (operationId) =>
      set((state) => cloneOperationForObjects(state, selectedIdSet(state), operationId, false)),
    makeOperationUniqueForObjects: (objectIds, operationId) =>
      set((state) => cloneOperationForObjects(state, new Set(objectIds), operationId, false)),
    addOperationForSelection: () =>
      set((state) => addOperationForObjects(state, selectedIdSet(state))),
    addOperationForObjects: (objectIds) =>
      set((state) => addOperationForObjects(state, new Set(objectIds))),
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
  };
}

function rebindObjects(
  state: OperationActionState,
  objectIds: ReadonlySet<string>,
  operationId: string,
): OperationMutation | Record<string, never> {
  if (!state.project.scene.layers.some((operation) => operation.id === operationId)) return {};
  if (objectIds.size === 0) return {};
  let changed = false;
  const objects = state.project.scene.objects.map((object) => {
    if (!objectIds.has(object.id)) return object;
    const next = bindSceneObjectToOperations(clearOperationOverride(object), [operationId]);
    if (sameOperationIds(object.operationIds, next.operationIds)) return object;
    changed = true;
    return next;
  });
  if (!changed) return {};
  const scene = pruneOrphanLayers({ ...state.project.scene, objects });
  return mutation(state, { ...state.project, scene });
}

function addOperationForObjects(
  state: OperationActionState,
  objectIds: ReadonlySet<string>,
): OperationMutation | Record<string, never> {
  const primary = objectsWithIds(state, objectIds)[0];
  if (primary === undefined) return {};
  const source = primaryOperationForObject(primary, state.project.scene.layers);
  return source === null ? {} : cloneOperationForObjects(state, objectIds, source.id, true);
}

function cloneOperationForObjects(
  state: OperationActionState,
  objectIds: ReadonlySet<string>,
  operationId: string,
  additive: boolean,
): OperationMutation | Record<string, never> {
  const source = state.project.scene.layers.find((layer) => layer.id === operationId);
  const first = objectsWithIds(state, objectIds)[0];
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
  const objects = state.project.scene.objects.map((object) => {
    if (!objectIds.has(object.id)) return object;
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

function objectsWithIds(
  state: OperationActionState,
  objectIds: ReadonlySet<string>,
): ReadonlyArray<SceneObject> {
  return state.project.scene.objects.filter((object) => objectIds.has(object.id));
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
