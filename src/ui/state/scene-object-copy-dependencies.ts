import type { SceneObject } from '../../core/scene';

/** Objects that must travel with a copied selection so persisted references stay local. */
export function sceneObjectCopyClosure(
  objects: ReadonlyArray<SceneObject>,
  selectedIds: ReadonlySet<string>,
): ReadonlyArray<SceneObject> {
  const objectsById = new Map(objects.map((object) => [object.id, object] as const));
  const closureIds = new Set(selectedIds);
  const pending = [...selectedIds];
  for (const id of pending) {
    const object = objectsById.get(id);
    if (object === undefined) continue;
    const dependencyId = sceneObjectCopyDependencyId(object);
    if (dependencyId === undefined || closureIds.has(dependencyId)) continue;
    closureIds.add(dependencyId);
    pending.push(dependencyId);
  }
  return objects.filter((object) => closureIds.has(object.id));
}

/** Rebind copied object references when the referenced object travelled with the copy. */
export function remapSceneObjectCopyDependencies(
  object: SceneObject,
  copiedIds: ReadonlyMap<string, string>,
): SceneObject {
  if (object.kind === 'raster-image' && object.imageMaskId !== undefined) {
    const imageMaskId = copiedIds.get(object.imageMaskId);
    return imageMaskId === undefined ? object : { ...object, imageMaskId };
  }
  if (object.kind === 'text' && object.pathText !== undefined) {
    const guideObjectId = copiedIds.get(object.pathText.guideObjectId);
    return guideObjectId === undefined
      ? object
      : { ...object, pathText: { ...object.pathText, guideObjectId } };
  }
  return object;
}

export function sceneObjectCopyDependencyId(object: SceneObject): string | undefined {
  if (object.kind === 'raster-image') return object.imageMaskId;
  if (object.kind === 'text') return object.pathText?.guideObjectId;
  return undefined;
}
