import {
  pathUsesOperation,
  sceneObjectUsesOperation,
  type Layer,
  type SceneObject,
} from '../../core/scene';

// Saved layer defaults accept only lowercase #rrggbb keys; restoring a record
// with any other key discards every saved default.
const DEFAULT_COLOR_KEY_RE = /^#[0-9a-f]{6}$/;

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

// The color a per-color saved default belongs to. Per-artwork operations take
// a palette color (ADR-211), so the artwork color the operation was created
// for is what a later import or drawing of that color can match. An operation
// without artwork keeps its own color.
export function defaultColorForOperation(
  objects: ReadonlyArray<SceneObject>,
  operation: Layer,
): string {
  const source = sourceColorForOperation(objects, operation)?.toLowerCase();
  return source !== undefined && DEFAULT_COLOR_KEY_RE.test(source) ? source : operation.color;
}
