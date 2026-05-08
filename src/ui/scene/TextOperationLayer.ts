/**
 * Text entry is a beginner-facing workflow, so it chooses an operation layer
 * explicitly instead of inheriting whatever mode the canvas happens to use.
 */

import { type Scene } from '../../core/scene/Scene';
import { createLayer, type LayerMode } from '../../core/scene/Layer';
import { type SceneObject } from '../../core/scene/SceneObject';

export type TextOperationMode = Extract<LayerMode, 'engrave' | 'cut'>;

export interface TextOperationLayerResult {
  readonly scene: Scene;
  readonly layerId: string;
  readonly layerCreated: boolean;
}

export interface AssignedTextOperationObjects extends TextOperationLayerResult {
  readonly objects: SceneObject[];
}

const TEXT_OPERATION_LAYER_NAMES: Record<TextOperationMode, string> = {
  engrave: 'Engrave',
  cut: 'Cut',
};

export function isTextOperationMode(mode: LayerMode | undefined): mode is TextOperationMode {
  return mode === 'engrave' || mode === 'cut';
}

export function textOperationModeForObject(
  scene: Scene,
  object: Pick<SceneObject, 'layerId'> | null,
): TextOperationMode {
  if (!object) return 'engrave';
  const mode = scene.layers.find(layer => layer.id === object.layerId)?.settings.mode;
  return isTextOperationMode(mode) ? mode : 'engrave';
}

export function resolveTextOperationLayer(
  scene: Scene,
  mode: TextOperationMode,
): TextOperationLayerResult {
  const existing = scene.layers.find(layer => layer.settings.mode === mode);
  if (existing) {
    return {
      scene: scene.activeLayerId === existing.id ? scene : { ...scene, activeLayerId: existing.id },
      layerId: existing.id,
      layerCreated: false,
    };
  }

  const maxOrder = scene.layers.length > 0
    ? Math.max(...scene.layers.map(layer => layer.order))
    : -1;
  const newLayer = createLayer(maxOrder + 1, mode, TEXT_OPERATION_LAYER_NAMES[mode]);

  return {
    scene: {
      ...scene,
      layers: [...scene.layers, newLayer],
      activeLayerId: newLayer.id,
    },
    layerId: newLayer.id,
    layerCreated: true,
  };
}

export function assignObjectsToTextOperationLayer(
  scene: Scene,
  objects: readonly SceneObject[],
  mode: TextOperationMode,
): AssignedTextOperationObjects {
  const resolved = resolveTextOperationLayer(scene, mode);
  return {
    ...resolved,
    objects: objects.map(obj => ({
      ...obj,
      layerId: resolved.layerId,
      _bounds: null,
      _worldTransform: null,
    })),
  };
}
