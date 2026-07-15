// Scene — the mutable view of what's on the bed. Mutations are pure: every
// operation returns a fresh Scene (CLAUDE.md "Mutable state — none").

import { normalizeLayerColor, type Layer } from './layer';
import { assertNever, type CncTabAnchor, type ColoredPath, type SceneObject } from './scene-object';

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

/** Changes an operation's presentation color while preserving its stable id.
 * Schema-v3 explicit bindings do not recolor source artwork. Legacy unbound
 * geometry follows the color so pre-v3 in-memory scenes keep working. */
export function recolorLayer(scene: Scene, layerId: string, color: string): Scene {
  const target = scene.layers.find((layer) => layer.id === layerId);
  if (target === undefined) return scene;
  const nextColor = normalizeLayerColor(color);
  if (target.color === nextColor) return scene;
  if (scene.layers.some((layer) => layer.id !== layerId && layer.color === nextColor)) return scene;
  return {
    ...scene,
    layers: scene.layers.map((layer) =>
      layer.id === layerId ? { ...layer, color: nextColor } : layer,
    ),
    objects: scene.objects.map((object) =>
      hasExplicitOperationBinding(object)
        ? object
        : recolorSceneObjectLayer(object, target.color, nextColor),
    ),
  };
}

function hasExplicitOperationBinding(object: SceneObject): boolean {
  return (
    object.operationIds !== undefined ||
    ('paths' in object && object.paths.some((path) => path.operationIds !== undefined))
  );
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
    case 'relief':
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

function recolorSceneObjectLayer(object: SceneObject, from: string, to: string): SceneObject {
  switch (object.kind) {
    case 'imported-svg':
    case 'traced-image':
      return recolorPathObject(object, from, to);
    case 'text':
    case 'shape':
      return recolorColoredPathObject(object, from, to);
    case 'raster-image':
    case 'relief':
      return recolorColoredObject(object, from, to);
    default:
      return assertNever(object, 'SceneObject');
  }
}

type PathObject = Extract<SceneObject, { kind: 'imported-svg' | 'traced-image' }>;
type ColoredPathObject = Extract<SceneObject, { kind: 'text' | 'shape' }>;
type ColoredObject = Extract<SceneObject, { kind: 'raster-image' | 'relief' }>;

function recolorPathObject(object: PathObject, from: string, to: string): PathObject {
  const paths = recolorMatchingPaths(object.paths, from, to);
  const anchors = recolorMatchingAnchors(object.cncTabAnchors, from, to);
  return paths === object.paths && anchors === object.cncTabAnchors
    ? object
    : { ...object, paths, ...(anchors === undefined ? {} : { cncTabAnchors: anchors }) };
}

function recolorColoredPathObject(
  object: ColoredPathObject,
  from: string,
  to: string,
): ColoredPathObject {
  const paths = recolorMatchingPaths(object.paths, from, to);
  const anchors = recolorMatchingAnchors(object.cncTabAnchors, from, to);
  const color = object.color === from ? to : object.color;
  return paths === object.paths && color === object.color && anchors === object.cncTabAnchors
    ? object
    : { ...object, color, paths, ...(anchors === undefined ? {} : { cncTabAnchors: anchors }) };
}

function recolorColoredObject(object: ColoredObject, from: string, to: string): ColoredObject {
  const anchors = recolorMatchingAnchors(object.cncTabAnchors, from, to);
  const color = object.color === from ? to : object.color;
  return color === object.color && anchors === object.cncTabAnchors
    ? object
    : { ...object, color, ...(anchors === undefined ? {} : { cncTabAnchors: anchors }) };
}

function recolorMatchingPaths(
  paths: ReadonlyArray<ColoredPath>,
  from: string,
  to: string,
): ReadonlyArray<ColoredPath> {
  if (!paths.some((path) => path.color === from)) return paths;
  return paths.map((path) => (path.color === from ? { ...path, color: to } : path));
}

function recolorMatchingAnchors(
  anchors: ReadonlyArray<CncTabAnchor> | undefined,
  from: string,
  to: string,
): ReadonlyArray<CncTabAnchor> | undefined {
  if (anchors === undefined || !anchors.some((anchor) => anchor.layerColor === from))
    return anchors;
  return anchors.map((anchor) =>
    anchor.layerColor === from ? { ...anchor, layerColor: to } : anchor,
  );
}
