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
  isLayerColor,
  layerFromSubLayer,
  layerOperationSettingsEqual,
  normalizeLayerColor,
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
  CubicPathSegment,
  CurveSubpath,
  DitherAlgorithm,
  FontKey,
  ImportedSvg,
  EllipticalArcPathSegment,
  LinePathSegment,
  ObjectOperationOverride,
  ObjectPowerScale,
  EllipseShape,
  Polyline,
  PathSegment,
  PolygonShape,
  RasterImage,
  RectangleShape,
  ReliefObject,
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
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  MAX_FLATTENED_CURVE_SEGMENTS,
  curveSubpathBounds,
  flattenColoredPathCurves,
  flattenCurveSubpath,
  polylineToCurveSubpath,
  transformCurveSubpathUniform,
  type FlattenCurveOptions,
  type FlattenColoredPathResult,
  type FlattenCurveResult,
  type UniformCurveTransform,
} from './curve-path';
export {
  breakCurveAtNode,
  convertCurveSegment,
  curveControlPoint,
  curveNodeCount,
  curveNodePoint,
  joinCurveSubpaths,
  moveCurveAnchor,
  moveCurveControl,
  setCurveStartNode,
  smoothCurveNode,
} from './curve-edit';
export {
  DITHER_ALGORITHMS,
  DEFAULT_RASTER_LAYER_COLOR,
  DEFAULT_RELIEF_LAYER_COLOR,
  RELIEF_EMBED_TRIANGLE_LIMIT,
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
export type { BestFitRectangle, BoardAnchor, BoardShape, BoardShapeKind } from './board-capture';
export {
  BOARD_CORNER_COUNT,
  bestFitRectangleFromCorners,
  boardCornersFromOrigin,
  boardMachinePoints,
  diameterFromCenterEdge,
  firstCornerOffsetMm,
} from './board-capture';
export type { BoxAnchorAlignError, BoxAnchorAlignResult } from './box-anchor-align';
export { buildBoxAnchorAlign } from './box-anchor-align';
export type {
  SelectionDistributeEdit,
  SelectionDistributeError,
  SelectionDistributeKind,
  SelectionDistributeResult,
} from './selection-distribute';
export { buildSelectionDistributeEdit } from './selection-distribute';
export { isClosedEnough, withClosingPoint } from './polyline-closure';
export type { OutputScope, OutputScopeValidation } from './output-scope';
export {
  DEFAULT_OUTPUT_SCOPE,
  filterSceneForOutputScope,
  validateOutputScope,
} from './output-scope';
export type { AABB } from './hit-test';
export { combinedBBox, hitTest, transformedBBox, transformedBounds } from './hit-test';
export { boardFitRegion } from './board-fit-region';
export { fitObjectToBed } from './fit-to-bed';
export { fitObjectToRegion, type FitToRegionOptions } from './fit-to-region';
export {
  MAX_TILE_PER_AXIS,
  tileIntoRegion,
  type TileLayout,
  type TileOffset,
} from './tile-into-region';
export {
  MAX_ARRAY_COPIES,
  arrayPlacements,
  type ArrayPlacement,
  type ArraySpec,
  type CircularArraySpec,
  type GridArraySpec,
} from './array-layout';
export type { PrintAndCutDesignTargets } from './print-and-cut';
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
export type {
  ProjectVariableData,
  VariableAdvancementPolicy,
  VariableCsvDataset,
  VariableCutSettingField,
  VariableDateTimeFormat,
  VariableTemplate,
  VariableTemplateToken,
} from './variable-template';
export { DEFAULT_PROJECT_VARIABLE_DATA } from './variable-template';

export type {
  CncCutDirection,
  CncCutType,
  CncLayerSettings,
  CncMachineConfig,
  CncMachineParams,
  CncStock,
  CncTiling,
  CncTool,
  CncToolKind,
  LaserMachineConfig,
  MachineConfig,
  MachineKind,
} from './machine';
export {
  CNC_CUT_TYPES,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_TILING,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_MACHINE_PARAMS,
  DEFAULT_CNC_STOCK,
  DEFAULT_CNC_TOOLS,
  LASER_MACHINE_CONFIG,
  activeCncTool,
  layerCncTool,
  cutTypeLabel,
  machineKindOf,
} from './machine';
