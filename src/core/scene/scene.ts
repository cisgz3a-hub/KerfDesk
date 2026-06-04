// Scene — the mutable view of what's on the bed. Mutations are pure: every
// operation returns a fresh Scene (CLAUDE.md "Mutable state — none").

import type { Layer } from './layer';
import type { SceneObject } from './scene-object';

export type Scene = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
};

export type LayerMoveDirection = 'up' | 'down';

export const EMPTY_SCENE: Scene = { objects: [], layers: [] };

export function addObject(scene: Scene, object: SceneObject): Scene {
  return { ...scene, objects: [...scene.objects, object] };
}

export function removeObject(scene: Scene, objectId: string): Scene {
  return { ...scene, objects: scene.objects.filter((o) => o.id !== objectId) };
}

// In-place replace by id — preserves array order so the object's
// stacking position, undo history shape, and any callers iterating
// scene.objects don't shift unexpectedly. Used by SVG re-import
// (Phase C) to swap the parsed content while keeping id + transform.
export function replaceObject(scene: Scene, objectId: string, replacement: SceneObject): Scene {
  return {
    ...scene,
    objects: scene.objects.map((o) => (o.id === objectId ? replacement : o)),
  };
}

export function addLayer(scene: Scene, layer: Layer): Scene {
  return { ...scene, layers: [...scene.layers, layer] };
}

export function updateLayer(
  scene: Scene,
  layerId: string,
  patch: Partial<Omit<Layer, 'id' | 'color'>>,
): Scene {
  return {
    ...scene,
    layers: scene.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
  };
}

export function removeLayer(scene: Scene, layerId: string): Scene {
  return { ...scene, layers: scene.layers.filter((l) => l.id !== layerId) };
}

export function moveLayer(scene: Scene, layerId: string, direction: LayerMoveDirection): Scene {
  const index = scene.layers.findIndex((layer) => layer.id === layerId);
  const nextIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= scene.layers.length) return scene;
  const layers = [...scene.layers];
  const [layer] = layers.splice(index, 1);
  if (layer === undefined) return scene;
  layers.splice(nextIndex, 0, layer);
  return { ...scene, layers };
}
