import { useMemo } from 'react';
import type { Scene } from '../../core/scene';
import { useStore } from '../state';
import { canMove, usesOnly } from '../state/operation-assignment';

/** Where the movable selected artwork sits relative to one operation: none
 * selected, all of it already on only that operation, or some elsewhere. */
export type SelectionPlacement = 'none' | 'here' | 'elsewhere';

export function selectionPlacement(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
  operationId: string,
): SelectionPlacement {
  const movable = scene.objects.filter((object) => selectedIds.has(object.id) && canMove(object));
  if (movable.length === 0) return 'none';
  return movable.every((object) => usesOnly(object, scene, operationId)) ? 'here' : 'elsewhere';
}

export function useSelectionPlacement(operationId: string): SelectionPlacement {
  const selectedObjectId = useStore((state) => state.selectedObjectId);
  const additionalSelectedIds = useStore((state) => state.additionalSelectedIds);
  const scene = useStore((state) => state.project.scene);
  return useMemo(() => {
    const selected = new Set(additionalSelectedIds);
    if (selectedObjectId !== null) selected.add(selectedObjectId);
    return selected.size === 0 ? 'none' : selectionPlacement(scene, selected, operationId);
  }, [additionalSelectedIds, operationId, scene, selectedObjectId]);
}
