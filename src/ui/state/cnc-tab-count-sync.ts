import { redistributeCncTabAnchors } from '../../core/cnc/cnc-tab-anchors';
import { DEFAULT_CNC_LAYER_SETTINGS, pathUsesOperation, type Scene } from '../../core/scene';

/** Runs inside the same project commit as the settings patch, so subscribers
 * and undo/redo never observe a new count paired with old eligible anchors. */
export function synchronizeCncTabCount(previous: Scene, next: Scene, operationId: string): Scene {
  const operation = next.layers.find((layer) => layer.id === operationId);
  const oldOperation = previous.layers.find((layer) => layer.id === operationId);
  const count = operation?.cnc?.tabsPerShape;
  if (
    operation === undefined ||
    oldOperation === undefined ||
    !operation.cnc?.cutType.startsWith('profile') ||
    count === undefined ||
    count === (oldOperation.cnc?.tabsPerShape ?? DEFAULT_CNC_LAYER_SETTINGS.tabsPerShape)
  )
    return next;

  let changed = false;
  const objects = next.objects.map((object) => {
    if (object.locked === true || !('paths' in object) || (object.cncTabAnchors?.length ?? 0) === 0)
      return object;
    const pathIndexes = new Set<number>();
    object.paths.forEach((path, index) => {
      if (!pathUsesOperation(object, path, operation)) return;
      // Anchors are path-owned, not operation-owned. A shared path cannot be
      // redistributed here without also changing another operation's positions.
      if (
        next.layers.some(
          (other) => other.id !== operation.id && pathUsesOperation(object, path, other),
        )
      )
        return;
      pathIndexes.add(index);
    });
    const cncTabAnchors = redistributeCncTabAnchors(object, pathIndexes, count);
    if (cncTabAnchors === object.cncTabAnchors || cncTabAnchors.length === 0) return object;
    changed = true;
    return { ...object, cncTabAnchors };
  });
  return changed ? { ...next, objects } : next;
}
