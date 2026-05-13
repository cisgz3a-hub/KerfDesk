import { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { remapClonedParentIds } from '../../core/scene/SceneOps';
import { generateId } from '../../core/types';

export interface UseQuickActionHandlersParams {
  scene: Scene;
  selectedIds: ReadonlySet<string>;
  setSelectedIds: (ids: ReadonlySet<string>) => void;
  handleSceneCommit: (newScene: Scene) => void;
  handleDelete: () => void;
  centerOnMaterial: () => void;
}

export interface QuickActionHandlers {
  handleQuickActionDuplicate: () => void;
  handleQuickActionDelete: () => void;
  handleQuickActionCenter: () => void;
}

export function useQuickActionHandlers(params: UseQuickActionHandlersParams): QuickActionHandlers {
  const {
    scene,
    selectedIds,
    setSelectedIds,
    handleSceneCommit,
    handleDelete,
    centerOnMaterial,
  } = params;

  const handleQuickActionDuplicate = useCallback(() => {
    if (selectedIds.size === 0) return;
    const newIds = new Set<string>();
    const clones: typeof scene.objects = [];
    const oldToNewId = new Map<string, string>();
    for (const obj of scene.objects) {
      if (!selectedIds.has(obj.id)) continue;
      const newId = generateId();
      newIds.add(newId);
      oldToNewId.set(obj.id, newId);
      clones.push({
        ...obj,
        id: newId,
        name: obj.name + ' copy',
        transform: { ...obj.transform, tx: obj.transform.tx + 5, ty: obj.transform.ty + 5 },
        _bounds: null,
        _worldTransform: null,
      });
    }
    const newScene = { ...scene, objects: [...scene.objects, ...remapClonedParentIds(clones, oldToNewId)] };
    handleSceneCommit(newScene);
    setSelectedIds(newIds);
  }, [scene, selectedIds, handleSceneCommit, setSelectedIds]);

  const handleQuickActionDelete = useCallback(() => {
    handleDelete();
  }, [handleDelete]);

  const handleQuickActionCenter = useCallback(() => {
    if (selectedIds.size === 0) return;
    centerOnMaterial();
  }, [selectedIds.size, centerOnMaterial]);

  return {
    handleQuickActionDuplicate,
    handleQuickActionDelete,
    handleQuickActionCenter,
  };
}
