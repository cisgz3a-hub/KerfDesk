import { replaceObject, type Scene, type SceneGroup, type SceneObject } from '../../core/scene';
import { duplicateArtworkWithOperations } from './duplicate-artwork';

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
    const duplicated = duplicateArtworkWithOperations(scene, original, newId);
    const remapped = remapDuplicatedMask(duplicated.scene, duplicated.object, idMap);
    scene = remapped.scene;
    if (selectedIds.has(oldId)) duplicatedSelectedIds.push(remapped.object.id);
  }
  return { scene, selectedIds: duplicatedSelectedIds };
}

function remapDuplicatedMask(
  scene: Scene,
  object: SceneObject,
  idMap: ReadonlyMap<string, string>,
): { readonly scene: Scene; readonly object: SceneObject } {
  if (object.kind !== 'raster-image' || object.imageMaskId === undefined) return { scene, object };
  const mappedMaskId = idMap.get(object.imageMaskId);
  if (mappedMaskId === undefined) return { scene, object };
  const remapped = { ...object, imageMaskId: mappedMaskId };
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
