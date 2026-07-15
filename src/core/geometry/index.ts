// Public API for the geometry module (ADR-015 boundary): cross-module consumers
// (ui + io) import Weld / boolean / offset / dogbone / arc-sampling from here, not
// from the leaf files. Intra-geometry code still imports the leaf modules directly
// (same-module deep imports are fine).
export {
  isVectorPathObject,
  materializeVectorObject,
  vectorObjectOutputMetadataCompatible,
  weldVectorObjects,
  type VectorSceneObject,
} from './vector-path-tools';
export {
  combineVectorObjects,
  offsetVectorObjects,
  type VectorBooleanOp,
} from './vector-path-booleans';
export { DOGBONE_MAX_CORNER_DEG, dogboneVectorObject } from './dogbone';
export { arcStepRad, sampleArcPoints } from './arc-sampling';
export { parametricEllipseCurve } from './ellipse-curve';
export { fitCubicsThroughPoints, sampleCubics, type CubicBezier } from './cubic-fit';
export { fairLineCurvePath, type CurveFairingOptions } from './curve-fairing';
