import { addObject, type Scene, type SceneGroup, type SceneObject } from '../../core/scene';
import {
  remapSceneObjectCopyDependencies,
  sceneObjectCopyClosure,
} from './scene-object-copy-dependencies';

export function duplicateSceneSelection(
  scene: Scene,
  selectedIdsInput: ReadonlyArray<string>,
  newIdFor: (oldId: string) => string,
): { readonly scene: Scene; readonly selectedIds: ReadonlyArray<string> } {
  const selectedIds = new Set(selectedIdsInput);
  const closureIds = sceneObjectCopyClosure(scene.objects, selectedIds).map((object) => object.id);
  const idMap = new Map(closureIds.map((oldId) => [oldId, newIdFor(oldId)] as const));
  const duplicated = duplicateClosure(scene, closureIds, selectedIds, idMap);
  return {
    scene: appendClonedGroups(duplicated.scene, scene.groups ?? [], idMap),
    selectedIds: duplicated.selectedIds,
  };
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
    const clone = remapSceneObjectCopyDependencies(
      { ...structuredClone(original), id: newId } as SceneObject,
      idMap,
    );
    scene = addObject(scene, clone);
    if (selectedIds.has(oldId)) duplicatedSelectedIds.push(clone.id);
  }
  return { scene, selectedIds: duplicatedSelectedIds };
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
  if (!group.objectIds.every((id) => idMap.has(id))) return [];
  const objectIds = group.objectIds.flatMap((id) => {
    const mapped = idMap.get(id);
    return mapped === undefined ? [] : [mapped];
  });
  return objectIds.length < 2 ? [] : [{ ...group, id: crypto.randomUUID(), objectIds }];
}
