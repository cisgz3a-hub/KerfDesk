import type { Scene } from '../../../core/scene/Scene';
import type { LayerMode } from '../../../core/scene/Layer';

export interface MaterialSuggestionRequest {
  materialName: string;
  machineType: string;
  layerMode: LayerMode;
}

/**
 * T2-6 Phase 3ah: pure material-suggestion request derivation.
 * App.tsx still owns async feedback lookup and toast side effects; this helper
 * owns the "do we have enough scene context to ask?" policy.
 */
export function resolveMaterialSuggestionRequest(scene: Scene): MaterialSuggestionRequest | null {
  const materialName = scene.material?.name;
  const activeLayer = scene.layers.find(layer => layer.id === scene.activeLayerId);

  if (!materialName || !activeLayer) return null;

  return {
    materialName,
    machineType: scene.machine?.type || 'diode',
    layerMode: activeLayer.settings.mode,
  };
}
