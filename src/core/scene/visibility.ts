import type { Layer } from './layer';
import type { Scene } from './scene';
import type { ColoredPath, SceneObject } from './scene-object';

type LayerVisibility = Pick<Layer, 'visible'>;

export function sceneObjectHasVisibleLayer(scene: Scene, object: SceneObject): boolean {
  return sceneObjectHasVisibleLayerFromMap(
    object,
    new Map(scene.layers.map((layer) => [layer.color, layer])),
  );
}

export function sceneObjectHasVisibleLayerFromMap(
  object: SceneObject,
  layerByColor: ReadonlyMap<string, LayerVisibility>,
): boolean {
  switch (object.kind) {
    case 'raster-image':
      return layerByColor.get(object.color)?.visible !== false;
    case 'shape':
    case 'text':
      if (layerByColor.get(object.color)?.visible === false) return false;
      return hasNonHiddenPathLayer(object.paths, layerByColor);
    case 'imported-svg':
    case 'traced-image':
      return hasNonHiddenPathLayer(object.paths, layerByColor);
    default:
      return object satisfies never;
  }
}

function hasNonHiddenPathLayer(
  paths: ReadonlyArray<ColoredPath>,
  layerByColor: ReadonlyMap<string, LayerVisibility>,
): boolean {
  return (
    paths.length === 0 || paths.some((path) => layerByColor.get(path.color)?.visible !== false)
  );
}
