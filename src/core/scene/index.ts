// core/scene — public API for the Scene domain model.
// Internal files MUST NOT be imported from outside this module (ESLint
// boundaries enforced). Cross-module callers import only from this index.

export type {
  Layer,
  LayerFillStyle,
  LayerMode,
  LayerOperationSettings,
  LayerSubLayer,
} from './layer';
export {
  LAYER_DEFAULTS,
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  layerFromSubLayer,
  layerOperationSettingsEqual,
  nextLayerSubLayerId,
  outputOperationLayers,
} from './layer';
export {
  REGISTRATION_LAYER_COLOR,
  REGISTRATION_LAYER_ID,
  createRegistrationLayer,
  findRegistrationBoxBounds,
  findRegistrationBoxes,
  findRegistrationLayer,
  hasRegistrationArtwork,
  isRegistrationBox,
  isRegistrationLayer,
  registrationOutputConflict,
  registrationRunState,
} from './registration-layer';
export type { RegistrationRunState } from './registration-layer';

export type {
  Bounds,
  ColoredPath,
  DitherAlgorithm,
  FontKey,
  ImportedSvg,
  ObjectOperationOverride,
  ObjectPowerScale,
  EllipseShape,
  Polyline,
  PolygonShape,
  RasterImage,
  RectangleShape,
  SceneObject,
  ShapeObject,
  ShapeSpec,
  StarShape,
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
  sceneObjectPrimaryLayerColor,
  sceneObjectUsesLayerColor,
} from './scene-object';

export { applyTransform, flipTransformAboutCenter } from './transform';
export type {
  SelectionAnchor,
  SelectionFlipAxis,
  SelectionMetrics,
  SelectionTransform,
  SelectionTransformEdit,
  SelectionTransformError,
  SelectionTransformResult,
} from './selection-transform';
export {
  buildSelectionFlipEdit,
  buildSelectionNudgeEdit,
  buildSelectionTransformEdit,
  selectionAnchorPoint,
  selectionMetrics,
} from './selection-transform';
export type {
  SelectionAlignEdit,
  SelectionAlignError,
  SelectionAlignKind,
  SelectionAlignResult,
} from './selection-align';
export { buildSelectionAlignEdit } from './selection-align';
export type {
  SelectionDistributeEdit,
  SelectionDistributeError,
  SelectionDistributeKind,
  SelectionDistributeResult,
} from './selection-distribute';
export { buildSelectionDistributeEdit } from './selection-distribute';
export { isClosedEnough } from './polyline-closure';
export type { OutputScope, OutputScopeValidation } from './output-scope';
export {
  DEFAULT_OUTPUT_SCOPE,
  filterSceneForOutputScope,
  validateOutputScope,
} from './output-scope';
export type { AABB } from './hit-test';
export { combinedBBox, hitTest, transformedBBox } from './hit-test';
export { fitObjectToBed } from './fit-to-bed';
export { sceneObjectHasVisibleLayer, sceneObjectHasVisibleLayerFromMap } from './visibility';

export type { Scene, SceneGroup } from './scene';
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
