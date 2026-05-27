// core/scene — public API for the Scene domain model.
// Internal files MUST NOT be imported from outside this module (ESLint
// boundaries enforced). Cross-module callers import only from this index.

export type { Layer, LayerMode } from './layer';
export { LAYER_DEFAULTS, createLayer } from './layer';

export type {
  Bounds,
  ColoredPath,
  FontKey,
  ImportedSvg,
  Polyline,
  SceneObject,
  TextAlignment,
  TextObject,
  Transform,
  Vec2,
} from './scene-object';
export { IDENTITY_TRANSFORM, assertNever } from './scene-object';

export { applyTransform } from './transform';
export type { AABB } from './hit-test';
export { hitTest, transformedBBox } from './hit-test';
export { fitObjectToBed } from './fit-to-bed';

export type { Scene } from './scene';
export {
  EMPTY_SCENE,
  addLayer,
  addObject,
  removeLayer,
  removeObject,
  replaceObject,
  updateLayer,
} from './scene';

export type { Project, Workspace } from './project';
export { PROJECT_SCHEMA_VERSION, createProject } from './project';
