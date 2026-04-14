import { useState, useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { duplicateObjects } from '../../core/scene/SceneOps';
import { generateId } from '../../core/types';

export function useClipboard(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  handleSceneCommit: (scene: Scene) => void,
  setSelectedIds: (ids: Set<string>) => void,
) {
  const [clipboard, setClipboard] = useState<SceneObject[]>([]);

  const handleCopy = useCallback(() => {
    if (selectedIds.size === 0) return;
    setClipboard(scene.objects.filter(o => selectedIds.has(o.id)));
  }, [scene, selectedIds]);

  const handlePaste = useCallback(() => {
    if (clipboard.length === 0) return;
    const newIds = new Set<string>();
    const parentIdMap = new Map<string, string>();

    const pasted = clipboard.map(obj => {
      const newId = generateId();
      newIds.add(newId);

      let newParentId = obj.parentId;
      if (obj.parentId) {
        if (!parentIdMap.has(obj.parentId)) {
          parentIdMap.set(obj.parentId, generateId());
        }
        newParentId = parentIdMap.get(obj.parentId)!;
      }

      return {
        ...obj,
        id: newId,
        parentId: newParentId,
        name: obj.name,
        powerScale: obj.powerScale ?? 1,
        transform: { ...obj.transform, tx: obj.transform.tx + 10, ty: obj.transform.ty + 10 },
        _bounds: null,
        _worldTransform: null,
      };
    });
    const newScene = { ...scene, objects: [...scene.objects, ...pasted] };
    handleSceneCommit(newScene);
    setSelectedIds(newIds);
    setClipboard(pasted);
  }, [clipboard, scene, handleSceneCommit, setSelectedIds]);

  const handleDuplicate = useCallback(() => {
    if (selectedIds.size === 0) return;
    const newScene = duplicateObjects(scene, selectedIds, 10, 10);
    handleSceneCommit(newScene);
    const existingIds = new Set(scene.objects.map(o => o.id));
    const duplicatedIds = new Set(
      newScene.objects.filter(o => !existingIds.has(o.id)).map(o => o.id),
    );
    setSelectedIds(duplicatedIds);
  }, [scene, selectedIds, handleSceneCommit, setSelectedIds]);

  return { clipboard, handleCopy, handlePaste, handleDuplicate };
}
