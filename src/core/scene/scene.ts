// Scene — the mutable view of what's on the bed. Mutations are pure: every
// operation returns a fresh Scene (CLAUDE.md "Mutable state — none").

import type { Layer } from './layer';
import { assertNever, type ColoredPath, type SceneObject } from './scene-object';

const LAYER_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export type Scene = {
  readonly objects: ReadonlyArray<SceneObject>;
  readonly layers: ReadonlyArray<Layer>;
  readonly groups?: ReadonlyArray<SceneGroup>;
};

export type SceneGroup = {
  readonly id: string;
  readonly name: string;
  readonly objectIds: ReadonlyArray<string>;
};

export type LayerMoveDirection = 'up' | 'down';

export const EMPTY_SCENE: Scene = { objects: [], layers: [], groups: [] };

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

export function assignObjectToLayer(scene: Scene, objectId: string, color: string): Scene {
  const nextColor = normalizeLayerColor(color);
  let changed = false;
  const objects = scene.objects.map((object) => {
    if (object.id !== objectId) return object;
    const assigned = assignSceneObjectColor(object, nextColor);
    if (assigned !== object) changed = true;
    return assigned;
  });
  return changed ? { ...scene, objects } : scene;
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

function assignSceneObjectColor(object: SceneObject, color: string): SceneObject {
  switch (object.kind) {
    case 'imported-svg': {
      const paths = recolorPaths(object.paths, color);
      return paths === object.paths ? object : { ...object, paths };
    }
    case 'text':
    case 'shape': {
      // text + shape both carry an explicit `color` alongside `paths`.
      const paths = recolorPaths(object.paths, color);
      return paths === object.paths && object.color === color
        ? object
        : { ...object, color, paths };
    }
    case 'traced-image': {
      const paths = recolorPaths(object.paths, color);
      return paths === object.paths ? object : { ...object, paths };
    }
    case 'raster-image':
      return object.color === color ? object : { ...object, color };
    default:
      return assertNever(object, 'SceneObject');
  }
}

function recolorPaths(
  paths: ReadonlyArray<ColoredPath>,
  color: string,
): ReadonlyArray<ColoredPath> {
  if (paths.every((path) => path.color === color)) return paths;
  return paths.map((path) => ({ ...path, color }));
}

function normalizeLayerColor(color: string): string {
  return LAYER_COLOR_RE.test(color) ? color.toLowerCase() : color;
}
