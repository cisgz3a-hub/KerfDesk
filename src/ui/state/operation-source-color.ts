import {
  pathUsesOperation,
  sceneObjectUsesOperation,
  type Layer,
  type SceneObject,
} from '../../core/scene';

export function sourceColorForOperation(
  objects: ReadonlyArray<SceneObject>,
  operation: Layer,
): string | null {
  for (const object of objects) {
    if ('paths' in object) {
      const path = object.paths.find((candidate) =>
        pathUsesOperation(object, candidate, operation),
      );
      if (path !== undefined) return path.color;
      continue;
    }
    if (sceneObjectUsesOperation(object, operation)) return object.color;
  }
  return null;
}
