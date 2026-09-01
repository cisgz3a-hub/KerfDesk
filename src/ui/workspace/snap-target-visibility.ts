import { sceneLayerVisibility, type Layer, type SceneObject } from '../../core/scene';

export function visibleSnapTargetPredicate(
  layers: ReadonlyArray<Layer>,
): (object: SceneObject) => boolean {
  const lookup = sceneLayerVisibility.lookup(layers);
  return (object) => sceneLayerVisibility.hasObject(object, lookup);
}
