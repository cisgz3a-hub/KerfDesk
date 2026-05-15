import type { Scene } from '../../../core/scene/Scene';
import type { SceneCommitAction } from '../../scene/SceneCommitActions';

export interface ActivateLayerCommit {
  scene: Scene;
  action: Extract<SceneCommitAction, 'activate-layer'>;
}

/**
 * T2-6 Phase 3ac: pure active-layer scene transaction builder.
 * App.tsx still owns the history commit, while this helper owns the
 * no-op check and activeLayerId scene replacement.
 */
export function buildActivateLayerCommit(
  scene: Scene,
  layerId: string,
): ActivateLayerCommit | null {
  if (scene.activeLayerId === layerId) return null;
  return {
    scene: { ...scene, activeLayerId: layerId },
    action: 'activate-layer',
  };
}
