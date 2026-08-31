import {
  addObject,
  replaceObject,
  type Scene,
  type SceneGroup,
  type SceneObject,
} from '../../core/scene';

export function duplicateSceneSelection(
  scene: Scene,
  selectedIdsInput: ReadonlyArray<string>,
  newIdFor: (oldId: string) => string,
): { readonly scene: Scene; readonly selectedIds: ReadonlyArray<string> } {
  const selectedIds = new Set(selectedIdsInput);
  const closureIds = duplicateClosureIds(scene, selectedIds);
  const idMap = new Map(closureIds.map((oldId) => [oldId, newIdFor(oldId)] as const));
  const duplicated = duplicateClosure(scene, closureIds, selectedIds, idMap);
  return {
    scene: appendClonedGroups(duplicated.scene, scene.groups ?? [], idMap),
    selectedIds: duplicated.selectedIds,
  };
}

function duplicateClosureIds(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  const closure = new Set(selectedIds);
  for (const object of scene.objects) {
    if (
      selectedIds.has(object.id) &&
      object.kind === 'raster-image' &&
      object.imageMaskId !== undefined
    ) {
      closure.add(object.imageMaskId);
    }
    if (selectedIds.has(object.id) && object.kind === 'text' && object.pathText !== undefined) {
      closure.add(object.pathText.guideObjectId);
    }
  }
  return scene.objects.filter((object) => closure.has(object.id)).map((object) => object.id);
}

function duplicateClosure(
  initialScene: Scene,
  closureIds: ReadonlyArray<string>,
  selectedIds: ReadonlySet<string>,
  idMap: ReadonlyMap<string, string>,
): { readonly scene: Scene; readonly selectedIds: ReadonlyArray<string> } {
  let scene = initialScene;
  const duplicatedSelectedIds: string[] = [];
  for (const oldId of closureIds) {
    const original = scene.objects.find((object) => object.id === oldId);
    const newId = idMap.get(oldId);
    if (original === undefined || newId === undefined) continue;
    // Duplicate stays in place; fresh import and paste own their stagger.
    // Duplicate is an in-place artwork clone, not a process duplication.
    // Keep the exact operation bindings and object-local override so a single
    // Duplicate cannot manufacture a second cutting operation over the same
    // geometry. structuredClone also prevents nested path/transform edits on
    // the clone from mutating the source object.
    const clone = { ...(structuredClone(original) as SceneObject), id: newId } as SceneObject;
    const duplicated = { scene: addObject(scene, clone), object: clone };
    const remapped = remapDuplicatedReferences(duplicated.scene, duplicated.object, idMap);
    scene = remapped.scene;
    if (selectedIds.has(oldId)) duplicatedSelectedIds.push(remapped.object.id);
  }
  return { scene, selectedIds: duplicatedSelectedIds };
}

function remapDuplicatedReferences(
  scene: Scene,
  object: SceneObject,
  idMap: ReadonlyMap<string, string>,
): { readonly scene: Scene; readonly object: SceneObject } {
  let remapped = object;
  if (object.kind === 'raster-image' && object.imageMaskId !== undefined) {
    const mappedMaskId = idMap.get(object.imageMaskId);
    if (mappedMaskId !== undefined) remapped = { ...object, imageMaskId: mappedMaskId };
  }
  if (object.kind === 'text' && object.pathText !== undefined) {
    const mappedGuideId = idMap.get(object.pathText.guideObjectId);
    if (mappedGuideId !== undefined) {
      remapped = { ...object, pathText: { ...object.pathText, guideObjectId: mappedGuideId } };
    }
  }
  if (remapped === object) return { scene, object };
  return { scene: replaceObject(scene, remapped.id, remapped), object: remapped };
}

function appendClonedGroups(
  scene: Scene,
  groups: ReadonlyArray<SceneGroup>,
  idMap: ReadonlyMap<string, string>,
): Scene {
  const clonedGroups = groups.flatMap((group) => cloneGroup(group, idMap));
  return clonedGroups.length === 0
    ? scene
    : { ...scene, groups: [...(scene.groups ?? []), ...clonedGroups] };
}

function cloneGroup(
  group: SceneGroup,
  idMap: ReadonlyMap<string, string>,
): ReadonlyArray<SceneGroup> {
  const objectIds = group.objectIds.flatMap((id) => {
    const mapped = idMap.get(id);
    return mapped === undefined ? [] : [mapped];
  });
  return objectIds.length < 2 ? [] : [{ ...group, id: crypto.randomUUID(), objectIds }];
}
