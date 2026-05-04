import { useCallback } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneObject } from '../../core/scene/SceneObject';
import { createLayer, type Layer } from '../../core/scene/Layer';
import { assertFeature } from '../../entitlements';

export interface UseMaterialTestHandlersParams {
  scene: Scene;
  handleSceneCommit: (newScene: Scene) => void;
}

export interface MaterialTestHandlers {
  handleMaterialTestApply: (
    rawObjects: SceneObject[],
    layerSettings: Array<{ power: number; speed: number }>,
    testMode: 'cut' | 'engrave',
  ) => void;
}

export function useMaterialTestHandlers(params: UseMaterialTestHandlersParams): MaterialTestHandlers {
  const { scene, handleSceneCommit } = params;

  const handleMaterialTestApply = useCallback((
    rawObjects: SceneObject[],
    layerSettings: Array<{ power: number; speed: number }>,
    testMode: 'cut' | 'engrave',
  ) => {
    // T1-78 Phase 2b: enforcement → assertFeature (throws EntitlementError).
    assertFeature('material_test');
    const baseOrder = scene.layers.length;
    const newLayers: Layer[] = layerSettings.map((ls, i) => {
      const layer = createLayer(baseOrder + i, testMode, `Test P${ls.power} S${ls.speed}`);
      const p = Math.max(0, Math.min(100, ls.power));
      const sp = Math.max(1, ls.speed);
      return {
        ...layer,
        order: baseOrder + i,
        settings: {
          ...layer.settings,
          mode: testMode,
          power: { min: 0, max: p },
          speed: sp,
          fill: {
            ...layer.settings.fill,
            enabled: testMode === 'engrave',
          },
          airAssist: testMode === 'cut',
        },
      };
    });

    const layerIds = newLayers.map(l => l.id);
    let squareIndex = 0;
    const remapped = rawObjects.map(obj => {
      if (obj.name.startsWith('Test P')) {
        const lid = layerIds[squareIndex] ?? layerIds[0];
        squareIndex += 1;
        return { ...obj, layerId: lid };
      }
      if (obj.name.startsWith('Label P')) {
        const lid = layerIds[Math.max(0, squareIndex - 1)] ?? layerIds[0];
        return { ...obj, layerId: lid };
      }
      const lid = layerIds[0] ?? scene.layers[0]?.id ?? '';
      return { ...obj, layerId: lid };
    });

    handleSceneCommit({
      ...scene,
      layers: [...scene.layers, ...newLayers],
      objects: [...scene.objects, ...remapped],
    });
  }, [scene, handleSceneCommit]);

  return { handleMaterialTestApply };
}
