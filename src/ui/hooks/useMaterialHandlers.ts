import { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type MaterialConfig } from '../components/MaterialDialog';
import { getPresetSettings, getAllMaterials } from '../../core/materials/MaterialPresets';

export interface UseMaterialHandlersParams {
  scene: Scene;
  handleSceneCommit: (newScene: Scene) => void;
  setShowMaterial: (show: boolean) => void;
}

export interface MaterialHandlers {
  handleMaterialConfirm: (config: MaterialConfig) => void;
  handleMaterialClear: () => void;
  handleMaterialPresetApply: (presetName: string) => boolean;
}

export function useMaterialHandlers(params: UseMaterialHandlersParams): MaterialHandlers {
  const { scene, handleSceneCommit, setShowMaterial } = params;

  const handleMaterialConfirm = useCallback((config: MaterialConfig) => {
    setShowMaterial(false);
    const newScene = {
      ...scene,
      material: {
        ...config,
        x: (scene.canvas.width - config.width) / 2,
        y: (scene.canvas.height - config.height) / 2,
        color: '',
        enabled: true,
      },
    };
    handleSceneCommit(newScene);
  }, [scene, handleSceneCommit]);

  const handleMaterialClear = useCallback(() => {
    setShowMaterial(false);
    handleSceneCommit({ ...scene, material: null });
  }, [scene, handleSceneCommit]);

  /** Apply a material preset — updates scene.material and adjusts ALL output layers. */
  const handleMaterialPresetApply = useCallback((presetName: string): boolean => {
    const machineType = scene.machine?.type || 'diode';
    const machineWatts = scene.machine?.watts || '10';
    const settings = getPresetSettings(presetName, machineType, machineWatts);
    if (!settings) return false;

    // Apply mode-appropriate settings to every output layer
    const newLayers = scene.layers.map(l => {
      if (!l.visible || l.output === false) return l;
      const mode = l.settings.mode;
      const s = mode === 'cut' ? settings.cut
        : mode === 'engrave' ? settings.engrave
        : mode === 'score' ? settings.score
        : settings.engrave;
      return {
        ...l,
        settings: {
          ...l.settings,
          power: { ...l.settings.power, max: s.power },
          speed: s.speed,
          passes: 'passes' in s ? s.passes : l.settings.passes,
        },
      };
    });

    // Determine material type from category
    const preset = getAllMaterials().find(p => p.name === presetName);
    const catMap: Record<string, NonNullable<Scene['material']>['type']> = {
      Acrylic: 'acrylic', Leather: 'leather', 'Paper & Card': 'paper',
      Fabric: 'fabric', Wood: 'wood', Plywood: 'wood', MDF: 'wood',
    };
    const matType = preset ? (catMap[preset.category] || 'custom') : 'custom';

    const matWidth = scene.canvas.width * 0.6;
    const matHeight = scene.canvas.height * 0.5;

    const updatedMaterial = scene.material
      ? { ...scene.material, name: presetName, type: matType, thickness: preset?.thickness ?? scene.material.thickness }
      : {
          type: matType, name: presetName,
          width: matWidth, height: matHeight,
          x: (scene.canvas.width - matWidth) / 2,
          y: (scene.canvas.height - matHeight) / 2,
          thickness: preset?.thickness ?? 3, color: '#c4956a', enabled: true,
        };

    handleSceneCommit({ ...scene, layers: newLayers, material: updatedMaterial });
    return true;
  }, [scene, handleSceneCommit]);

  return {
    handleMaterialConfirm,
    handleMaterialClear,
    handleMaterialPresetApply,
  };
}
