import { cloneSelectionGroups } from './clone-selection-groups';
import type { SceneObject } from '../../core/scene';
import { addObjects, type Scene, type SceneGroup } from '../../core/scene/scene';
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
  const closure = sceneObjectCopyClosure(scene.objects, selectedIds);
  const idMap = new Map(closure.map((object) => [object.id, newIdFor(object.id)] as const));
  const duplicated = duplicateClosure(scene, closure, selectedIds, idMap);
  return {
    scene: appendClonedGroups(duplicated.scene, scene.groups ?? [], idMap),
    selectedIds: duplicated.selectedIds,
  };
}

// The closure already holds the originals in scene order, and the clones are
// appended in one copy: a lookup and an append per object made Duplicate
// O(selected × objects) (J10-P2-1).
function duplicateClosure(
  initialScene: Scene,
  closure: ReadonlyArray<SceneObject>,
  selectedIds: ReadonlySet<string>,
  idMap: ReadonlyMap<string, string>,
): { readonly scene: Scene; readonly selectedIds: ReadonlyArray<string> } {
  const clones: SceneObject[] = [];
  const duplicatedSelectedIds: string[] = [];
  for (const original of closure) {
    const oldId = original.id;
    const newId = idMap.get(oldId);
    if (newId === undefined) continue;
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
    clones.push(clone);
    if (selectedIds.has(oldId)) duplicatedSelectedIds.push(clone.id);
  }
  return { scene: addObjects(initialScene, clones), selectedIds: duplicatedSelectedIds };
}

function appendClonedGroups(
  scene: Scene,
  groups: ReadonlyArray<SceneGroup>,
  idMap: ReadonlyMap<string, string>,
): Scene {
  const clonedGroups = cloneSelectionGroups(groups, new Set(idMap.keys()), idMap, () =>
    crypto.randomUUID(),
  );
  return clonedGroups.length === 0
    ? scene
    : { ...scene, groups: [...(scene.groups ?? []), ...clonedGroups] };
}
