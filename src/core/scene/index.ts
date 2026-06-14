// core/scene — public API for the Scene domain model.
// Internal files MUST NOT be imported from outside this module (ESLint
// boundaries enforced). Cross-module callers import only from this index.

export type { Layer, LayerMode } from './layer';
export { LAYER_DEFAULTS, createLayer } from './layer';

export type {
  Bounds,
  ColoredPath,
  DitherAlgorithm,
  FontKey,
  ImportedSvg,
  ObjectPowerScale,
  Polyline,
  RasterImage,
  RectangleShape,
  SceneObject,
  ShapeObject,
  ShapeSpec,
  TextAlignment,
  TextObject,
  TracedImage,
  Transform,
  Vec2,
} from './scene-object';
export {
  DITHER_ALGORITHMS,
  DEFAULT_RASTER_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  assertNever,
} from './scene-object';

export { applyTransform } from './transform';
export { isClosedEnough } from './polyline-closure';
export type { AABB } from './hit-test';
export { combinedBBox, hitTest, transformedBBox } from './hit-test';
export { fitObjectToBed } from './fit-to-bed';

export type { Scene } from './scene';
export type { LayerMoveDirection } from './scene';
export {
  EMPTY_SCENE,
  addLayer,
  addObject,
  assignObjectToLayer,
  moveLayer,
  removeLayer,
  removeObject,
  replaceObject,
  updateLayer,
} from './scene';

export type { Project, ProjectOptimizationSettings, Workspace } from './project';
export { DEFAULT_PROJECT_OPTIMIZATION, PROJECT_SCHEMA_VERSION, createProject } from './project';
