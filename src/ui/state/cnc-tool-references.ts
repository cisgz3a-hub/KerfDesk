import { type Scene } from '../../core/scene';

/** Removes every secondary assignment to a deleted custom bit. The operation
 * remains available and its selector falls back to the active bit. */
export function sceneWithoutCncSecondaryToolReferences(scene: Scene, toolId: string): Scene {
  let changed = false;
  const layers = scene.layers.map((layer) => {
    if (layer.cnc === undefined) return layer;
    let next = layer.cnc;
    if (next.vClearToolId === toolId) {
      const { vClearToolId: _removed, ...rest } = next;
      next = rest;
    }
    if (next.pocketRoughToolId === toolId) {
      const { pocketRoughToolId: _removed, ...rest } = next;
      next = rest;
    }
    if (next.reliefFinishToolId === toolId) {
      const { reliefFinishToolId: _removed, ...rest } = next;
      next = rest;
    }
    if (next === layer.cnc) return layer;
    changed = true;
    return { ...layer, cnc: next };
  });
  return changed ? { ...scene, layers } : scene;
}
