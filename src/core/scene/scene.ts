// Scene — the mutable view of what's on the bed. Mutations are pure: every
// operation returns a fresh Scene (CLAUDE.md "Mutable state — none").

import type { Layer } from './layer';
import type { SceneObject } from './scene-object';

export type Scene = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
};

export const EMPTY_SCENE: Scene = { objects: [], layers: [] };

export function addObject(scene: Scene, object: SceneObject): Scene {
  return { ...scene, objects: [...scene.objects, object] };
}

export function removeObject(scene: Scene, objectId: string): Scene {
  return { ...scene, objects: scene.objects.filter((o) => o.id !== objectId) };
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
