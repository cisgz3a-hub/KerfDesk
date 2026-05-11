/**
 * T1-142: pure layer add / remove transforms extracted from
 * LayerPanel. Pre-T1-142 these two operations lived inline as
 * `handleAddLayer` / `handleRemoveLayer` useCallback bodies and
 * could only be exercised by mounting the panel and clicking the
 * buttons. The actual scene mutation rules (mode cycling, naming
 * with suffix when the first 4 modes are exhausted, last-layer
 * protection, orphan-object cleanup) are pure data transforms.
 *
 * Hoisting them gives a single place to read the rules and lets the
 * naming pattern + objects-on-removed-layer cleanup behavior be
 * pinned in isolation.
 */
import type { Scene } from '../../../core/scene/Scene';
import { createLayer, type LayerMode } from '../../../core/scene/Layer';

/** Cycle: 5th layer → "Cut 2", 6th → "Engrave 2", etc. */
const LAYER_MODE_CYCLE: ReadonlyArray<LayerMode> = ['cut', 'engrave', 'score', 'image'];
const LAYER_NAME_CYCLE: ReadonlyArray<string> = ['Cut', 'Engrave', 'Score', 'Image'];

/**
 * Append a new layer to `scene`, cycling through cut/engrave/score/image.
 * After the first four layers the name gets a numeric suffix
 * (`Cut 2`, `Engrave 2`, ...). The new layer becomes active.
 */
export function addSceneLayer(scene: Scene): Scene {
  const nextIndex = scene.layers.length;
  const mode = LAYER_MODE_CYCLE[nextIndex % LAYER_MODE_CYCLE.length];
  const baseName = LAYER_NAME_CYCLE[nextIndex % LAYER_NAME_CYCLE.length];
  const suffix = nextIndex >= 4 ? ' ' + Math.floor(nextIndex / 4 + 1) : '';
  const name = baseName + suffix;
  const newLayer = createLayer(nextIndex, mode, name);
  return {
    ...scene,
    layers: [...scene.layers, newLayer],
    activeLayerId: newLayer.id,
  };
}

/**
 * Remove `scene.activeLayerId` and every object that belongs to it.
 * Returns the previous scene unchanged when only one layer is left
 * (last-layer protection — a scene must always have at least one
 * layer). The first remaining layer becomes active.
 */
export function removeActiveSceneLayer(scene: Scene): Scene {
  if (scene.layers.length <= 1) return scene;
  const activeId = scene.activeLayerId;
  const newLayers = scene.layers.filter((l) => l.id !== activeId);
  const newObjects = scene.objects.filter((o) => o.layerId !== activeId);
  return {
    ...scene,
    layers: newLayers,
    objects: newObjects,
    activeLayerId: newLayers[0].id,
  };
}
