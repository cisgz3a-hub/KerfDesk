import { deleteObjects } from '../../../core/scene/SceneOps';
import type { Scene } from '../../../core/scene/Scene';

export interface DeleteSelectionCommit {
  scene: Scene;
  action: 'delete';
  selectionAfter: ReadonlySet<string>;
}

/**
 * T2-6 Phase 3ab: pure delete-selection transaction builder. App.tsx
 * still owns the dirty/history commit, while this helper owns the
 * scene deletion and atomic post-delete selection state.
 */
export function buildDeleteSelectionCommit(
  scene: Scene,
  selectedIds: ReadonlySet<string>,
): DeleteSelectionCommit | null {
  if (selectedIds.size === 0) return null;
  return {
    scene: deleteObjects(scene, selectedIds),
    action: 'delete',
    selectionAfter: new Set(),
  };
}
