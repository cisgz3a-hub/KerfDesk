import { layerSubLayerOperationId, type Layer } from './layer';
import type { ColoredPath, SceneObject } from './scene-object';

type OperationIdentity = Pick<Layer, 'id' | 'color' | 'bindingOperationId'>;

/** True when this path is explicitly bound to an operation. Explicit path
 * bindings take precedence over whole-artwork bindings; schema-v2 color
 * matching remains the final compatibility fallback. */
export function pathUsesOperation(
  object: SceneObject,
  path: ColoredPath,
  operation: OperationIdentity,
): boolean {
  const ids = path.operationIds ?? object.operationIds;
  const bindingId = operation.bindingOperationId ?? operation.id;
  return ids === undefined ? path.color === operation.color : ids.includes(bindingId);
}

export function sceneObjectUsesOperation(
  object: SceneObject,
  operation: OperationIdentity,
): boolean {
  const bindingId = operation.bindingOperationId ?? operation.id;
  if ('paths' in object) {
    if (object.paths.length === 0) {
      if (object.operationIds !== undefined) return object.operationIds.includes(bindingId);
      return 'color' in object && object.color === operation.color;
    }
    return object.paths.some((path) => pathUsesOperation(object, path, operation));
  }
  return object.operationIds === undefined
    ? object.color === operation.color
    : object.operationIds.includes(bindingId);
}

export function operationIdsForObject(
  object: SceneObject,
  operations: ReadonlyArray<OperationIdentity>,
): ReadonlyArray<string> {
  return operations
    .filter((operation) => sceneObjectUsesOperation(object, operation))
    .map((operation) => operation.id);
}

export function primaryOperationForObject(
  object: SceneObject,
  operations: ReadonlyArray<Layer>,
): Layer | null {
  return operations.find((operation) => sceneObjectUsesOperation(object, operation)) ?? null;
}

export function bindSceneObjectToOperations(
  object: SceneObject,
  operationIds: ReadonlyArray<string>,
): SceneObject {
  const uniqueIds = [...new Set(operationIds)];
  if (!('paths' in object)) return { ...object, operationIds: uniqueIds };
  return {
    ...object,
    operationIds: uniqueIds,
    paths: object.paths.map(withoutPathOperationIds),
  } as SceneObject;
}

export function addSceneObjectOperation(object: SceneObject, operationId: string): SceneObject {
  const current = object.operationIds ?? [];
  return bindSceneObjectToOperations(object, [...current, operationId]);
}

export function appendSceneObjectOperationBinding(
  object: SceneObject,
  operationId: string,
  operations: ReadonlyArray<Layer>,
): SceneObject {
  return transformOperationBindings(object, operations, (ids) => [...ids, operationId]);
}

export function replaceSceneObjectOperationBinding(
  object: SceneObject,
  sourceOperationId: string,
  replacementOperationId: string,
  operations: ReadonlyArray<Layer>,
): SceneObject {
  const scoped = remapObjectOperationOverride(
    object,
    expandedOperationIdMap(operations, new Map([[sourceOperationId, replacementOperationId]])),
    true,
  );
  return transformOperationBindings(scoped, operations, (ids) =>
    ids.map((id) => (id === sourceOperationId ? replacementOperationId : id)),
  );
}

export function removeSceneObjectOperationBinding(
  object: SceneObject,
  operationId: string,
  operations: ReadonlyArray<Layer>,
): SceneObject | null {
  const scoped = remapObjectOperationOverride(
    object,
    expandedOperationIdMap(operations, new Map([[operationId, null]])),
    true,
  );
  const next = transformOperationBindings(scoped, operations, (ids) =>
    ids.filter((id) => id !== operationId),
  );
  return hasExplicitOperationBinding(next) ? next : null;
}

export function operationArtworkCount(
  objects: ReadonlyArray<SceneObject>,
  operation: OperationIdentity,
): number {
  return objects.filter((object) => sceneObjectUsesOperation(object, operation)).length;
}

/** Copy an artwork's explicit operation topology onto a new set of operation
 * IDs. Legacy color bindings are promoted while copying, so path-specific
 * imported operations remain path-specific. */
export function remapSceneObjectOperationBindings(
  object: SceneObject,
  sourceOperations: ReadonlyArray<Layer>,
  operationIdMap: ReadonlyMap<string, string>,
): SceneObject {
  const scoped = remapObjectOperationOverride(
    object,
    expandedOperationIdMap(sourceOperations, operationIdMap),
    false,
  );
  const objectOperationIds = object.operationIds?.flatMap((id) => mappedId(id, operationIdMap));
  if (!('paths' in object)) {
    const sourceIds =
      objectOperationIds ?? mappedObjectOperationIds(object, sourceOperations, operationIdMap);
    return sourceIds.length === 0 ? scoped : { ...scoped, operationIds: sourceIds };
  }
  const paths = object.paths.map((path) =>
    remapPathOperationBindings(object, path, sourceOperations, operationIdMap),
  );
  return {
    ...scoped,
    ...(objectOperationIds === undefined ? {} : { operationIds: objectOperationIds }),
    paths,
  } as SceneObject;
}

export function pruneSceneObjectOperationOverrides(
  objects: ReadonlyArray<SceneObject>,
  operations: ReadonlyArray<Layer>,
): ReadonlyArray<SceneObject> {
  const ids = expandedOperationIdMap(operations, new Map(operations.map(({ id }) => [id, id])));
  let changed = false;
  const next = objects.map((object) => {
    if (Object.keys(object.operationOverride?.byOperation ?? {}).every((id) => ids.has(id)))
      return object;
    changed = true;
    return remapObjectOperationOverride(object, ids, false);
  });
  return changed ? next : objects;
}

function expandedOperationIdMap(
  operations: ReadonlyArray<Layer>,
  operationIdMap: ReadonlyMap<string, string | null>,
): ReadonlyMap<string, string | null> {
  const expanded = new Map(operationIdMap);
  for (const operation of operations) {
    if (!operationIdMap.has(operation.id)) continue;
    const target = operationIdMap.get(operation.id);
    for (const subLayer of operation.subLayers) {
      expanded.set(
        layerSubLayerOperationId(operation.id, subLayer.id),
        target == null ? null : layerSubLayerOperationId(target, subLayer.id),
      );
    }
  }
  return expanded;
}

function remapObjectOperationOverride(
  object: SceneObject,
  operationIdMap: ReadonlyMap<string, string | null>,
  keepUnmapped: boolean,
): SceneObject {
  const override = object.operationOverride;
  if (override?.byOperation === undefined) return object;
  const byOperation = Object.fromEntries(
    Object.entries(override.byOperation).flatMap(([id, settings]) => {
      const target = operationIdMap.has(id) ? operationIdMap.get(id) : keepUnmapped ? id : null;
      return target == null ? [] : [[target, settings]];
    }),
  );
  return { ...object, operationOverride: { ...override, byOperation } };
}

function withoutPathOperationIds(path: ColoredPath): ColoredPath {
  if (path.operationIds === undefined) return path;
  const { operationIds: _operationIds, ...rest } = path;
  return rest;
}

function transformOperationBindings(
  object: SceneObject,
  operations: ReadonlyArray<Layer>,
  transform: (ids: ReadonlyArray<string>) => ReadonlyArray<string>,
): SceneObject {
  if (!('paths' in object) || object.paths.length === 0) {
    const ids = object.operationIds ?? operationIdsForObject(object, operations);
    return { ...object, operationIds: uniqueOperationIds(transform(ids)) } as SceneObject;
  }
  if (object.operationIds !== undefined) {
    return {
      ...object,
      operationIds: uniqueOperationIds(transform(object.operationIds)),
      paths: object.paths.map((path) =>
        path.operationIds === undefined
          ? path
          : { ...path, operationIds: uniqueOperationIds(transform(path.operationIds)) },
      ),
    } as SceneObject;
  }
  return {
    ...object,
    paths: object.paths.map((path) => {
      const ids =
        path.operationIds ??
        operations
          .filter((operation) => pathUsesOperation(object, path, operation))
          .map((operation) => operation.id);
      return { ...path, operationIds: uniqueOperationIds(transform(ids)) };
    }),
  } as SceneObject;
}

function hasExplicitOperationBinding(object: SceneObject): boolean {
  if (!('paths' in object) || object.paths.length === 0) {
    return (object.operationIds?.length ?? 0) > 0;
  }
  return object.paths.some((path) => (path.operationIds ?? object.operationIds ?? []).length > 0);
}

function uniqueOperationIds(ids: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(ids)];
}

function remapPathOperationBindings(
  object: SceneObject,
  path: ColoredPath,
  sourceOperations: ReadonlyArray<Layer>,
  operationIdMap: ReadonlyMap<string, string>,
): ColoredPath {
  if (path.operationIds === undefined && object.operationIds !== undefined) return path;
  const sourceIds =
    path.operationIds ??
    sourceOperations
      .filter((operation) => pathUsesOperation(object, path, operation))
      .map((operation) => operation.id);
  const operationIds = sourceIds.flatMap((id) => mappedId(id, operationIdMap));
  return operationIds.length === 0 ? path : { ...path, operationIds };
}

function mappedObjectOperationIds(
  object: SceneObject,
  sourceOperations: ReadonlyArray<Layer>,
  operationIdMap: ReadonlyMap<string, string>,
): ReadonlyArray<string> {
  return sourceOperations
    .filter((operation) => sceneObjectUsesOperation(object, operation))
    .flatMap((operation) => mappedId(operation.id, operationIdMap));
}

function mappedId(id: string, operationIdMap: ReadonlyMap<string, string>): ReadonlyArray<string> {
  const mapped = operationIdMap.get(id);
  return mapped === undefined ? [] : [mapped];
}
