import { createLayer, type LayerMode } from '../../../core/scene/Layer';
import type { Scene } from '../../../core/scene/Scene';
import type { SceneCommitAction } from '../../scene/SceneCommitActions';

const MODE_LAYER_NAMES: Record<string, string> = {
  cut: 'Cut',
  engrave: 'Engrave',
  score: 'Score',
  image: 'Image',
};

export interface ModeTabSelectResult {
  previousScene: Scene;
  scene: Scene;
  action: Extract<SceneCommitAction, 'mode-select'> | null;
  selectionAfter: ReadonlySet<string>;
}

function selectableIdsForMode(scene: Scene, mode: string): Set<string> {
  const modeLayerIds = new Set(
    scene.layers.filter(l => l.settings.mode === mode).map(l => l.id),
  );
  return new Set(
    scene.objects
      .filter(o => o.visible && modeLayerIds.has(o.layerId))
      .map(o => o.id),
  );
}

/**
 * T2-6 Phase 3aa: pure mode-tab scene/selection decision. Existing
 * mode layers preserve App's historical no-history active-layer switch;
 * missing modes still create a layer via the `mode-select` history path.
 */
export function buildModeTabSelectResult(
  scene: Scene,
  mode: string,
): ModeTabSelectResult {
  const targetLayer = scene.layers.find(l => l.settings.mode === mode);

  if (targetLayer) {
    const next =
      scene.activeLayerId === targetLayer.id
        ? scene
        : { ...scene, activeLayerId: targetLayer.id };
    return {
      previousScene: scene,
      scene: next,
      action: null,
      selectionAfter: selectableIdsForMode(next, mode),
    };
  }

  const maxOrder =
    scene.layers.length > 0 ? Math.max(...scene.layers.map(l => l.order)) : -1;
  const newLayer = createLayer(
    maxOrder + 1,
    mode as LayerMode,
    MODE_LAYER_NAMES[mode] ?? mode,
  );
  const next: Scene = {
    ...scene,
    layers: [...scene.layers, newLayer],
    activeLayerId: newLayer.id,
  };

  return {
    previousScene: scene,
    scene: next,
    action: 'mode-select',
    selectionAfter: selectableIdsForMode(next, mode),
  };
}
