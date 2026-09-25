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
    for (const dependencyId of sceneObjectCopyDependencyIds(object)) {
      if (closureIds.has(dependencyId)) continue;
      closureIds.add(dependencyId);
      pending.push(dependencyId);
    }
  }
  return objects.filter((object) => closureIds.has(object.id));
}

/** Rebind copied object references when the referenced object travelled with the copy. */
export function remapSceneObjectCopyDependencies(
  object: SceneObject,
  copiedIds: ReadonlyMap<string, string>,
  options: { readonly preserveSvgImport?: boolean } = {},
): SceneObject {
  // A duplicate is a fresh owner, never a member of the source file's replacement set.
  // Array placement also remaps dependencies on originals that keep their identity.
  if (options.preserveSvgImport !== true) object = withoutSvgImport(object);
  if ('traceSourceId' in object && object.traceSourceId !== undefined) {
    const traceSourceId = copiedIds.get(object.traceSourceId);
    if (traceSourceId !== undefined) object = { ...object, traceSourceId };
  }
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

function withoutSvgImport(object: SceneObject): SceneObject {
  if (object.svgImport === undefined) return object;
  const { svgImport: _source, ...detached } = object;
  return detached;
}

export function sceneObjectCopyDependencyIds(object: SceneObject): readonly string[] {
  const primary = sceneObjectCopyDependencyId(object);
  const trace = 'traceSourceId' in object ? object.traceSourceId : undefined;
  return [...(primary === undefined ? [] : [primary]), ...(trace === undefined ? [] : [trace])];
}

export function sceneObjectCopyDependencyId(object: SceneObject): string | undefined {
  if (object.kind === 'raster-image') return object.imageMaskId;
  if (object.kind === 'text') return object.pathText?.guideObjectId;
  return undefined;
}
