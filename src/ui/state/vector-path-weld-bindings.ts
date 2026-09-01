import type { VectorSceneObject } from '../../core/geometry';
import { pathUsesOperation, type ColoredPath, type Layer, type Scene } from '../../core/scene';

export type WeldPathAssignment = {
  readonly object: VectorSceneObject;
  readonly path: ColoredPath;
};

export type WeldOperationBucket = {
  readonly sourceLayerId: string | null;
  readonly signature: string;
  readonly effectiveLayer: Layer;
  readonly assignments: WeldPathAssignment[];
  readonly requiresIsolation: boolean;
};

export function reservedWeldOperationIds(scene: Scene): Set<string> {
  const ids = new Set(
    scene.layers.flatMap((layer) => [layer.id, layer.bindingOperationId]).filter(isString),
  );
  for (const object of scene.objects) {
    for (const id of object.operationIds ?? []) ids.add(id);
    if (!('paths' in object)) continue;
    for (const path of object.paths) {
      for (const id of path.operationIds ?? []) ids.add(id);
    }
  }
  return ids;
}

export function legacyWeldOperationColors(scene: Scene): Set<string> {
  const colors = new Set<string>();
  for (const object of scene.objects) {
    if ('paths' in object) {
      for (const path of object.paths) {
        if ((path.operationIds ?? object.operationIds) === undefined) {
          colors.add(path.color.toLowerCase());
        }
      }
      continue;
    }
    if (
      object.operationIds === undefined &&
      'color' in object &&
      typeof object.color === 'string'
    ) {
      colors.add(object.color.toLowerCase());
    }
  }
  return colors;
}

export function nextAvailableWeldOperationId(
  base: string,
  occupiedOperationIds: ReadonlySet<string>,
): string {
  if (!occupiedOperationIds.has(base)) return base;
  let suffix = 2;
  while (occupiedOperationIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function prepareUnassignedWeldObjects(
  buckets: ReadonlyArray<WeldOperationBucket>,
  objects: ReadonlyArray<VectorSceneObject>,
  scene: Scene,
  resultId: string,
  occupiedOperationIds: Set<string>,
): ReadonlyArray<VectorSceneObject> {
  let unassignedIndex = 0;
  return objects.flatMap((object) => {
    const paths = object.paths.flatMap((path) => {
      const inheritedIds = path.operationIds ?? object.operationIds;
      if (inheritedIds !== undefined) {
        const liveBindingIds = new Set(
          scene.layers
            .filter((layer) => pathUsesOperation(object, path, layer))
            .map((layer) => layer.bindingOperationId ?? layer.id),
        );
        const residualIds = inheritedIds.filter((id) => !liveBindingIds.has(id));
        return residualIds.length === 0 && inheritedIds.length > 0
          ? []
          : [{ ...path, operationIds: residualIds }];
      }
      if (pathIsAssigned(buckets, object, path)) return [];
      // Keep a legacy path with no matching operation fail-visible and
      // output-inert even if a cloned operation later reuses its color.
      const operationId = nextUnassignedOperationId(
        occupiedOperationIds,
        resultId,
        unassignedIndex,
      );
      unassignedIndex += 1;
      occupiedOperationIds.add(operationId);
      return [{ ...path, operationIds: [operationId] }];
    });
    return paths.length === 0 ? [] : [withoutObjectOutputMetadata(object, paths)];
  });
}

export function prepareWeldObjectsForBucket(
  bucket: WeldOperationBucket,
  operationId: string,
): ReadonlyArray<VectorSceneObject> {
  const assignmentsByObject = new Map<VectorSceneObject, ColoredPath[]>();
  for (const assignment of bucket.assignments) {
    const paths = assignmentsByObject.get(assignment.object) ?? [];
    paths.push({ ...assignment.path, operationIds: [operationId] });
    assignmentsByObject.set(assignment.object, paths);
  }
  return [...assignmentsByObject].map(([object, paths]) =>
    withoutObjectOutputMetadata(object, paths),
  );
}

function nextUnassignedOperationId(
  occupiedOperationIds: ReadonlySet<string>,
  resultId: string,
  index: number,
): string {
  const base = `orphan-${resultId}-${index + 1}`;
  return nextAvailableWeldOperationId(base, occupiedOperationIds);
}

function pathIsAssigned(
  buckets: ReadonlyArray<WeldOperationBucket>,
  object: VectorSceneObject,
  path: ColoredPath,
): boolean {
  return buckets.some((bucket) =>
    bucket.assignments.some(
      (assignment) => assignment.object === object && assignment.path === path,
    ),
  );
}

function withoutObjectOutputMetadata(
  object: VectorSceneObject,
  paths: ReadonlyArray<ColoredPath>,
): VectorSceneObject {
  const {
    operationIds: _operationIds,
    operationOverride: _operationOverride,
    powerScale: _powerScale,
    locked: _locked,
    ...rest
  } = object;
  return { ...rest, paths } as VectorSceneObject;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
