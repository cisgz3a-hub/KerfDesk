// Public API for the geometry module (ADR-015 boundary): cross-module consumers
// import Weld / boolean / offset / dogbone from here, not from the leaf files.
// Intra-geometry code still imports the leaf modules directly (same-module deep
// imports are fine). The arc-sampling helpers are consumed by the io layer via
// their own path and are not re-exported here — that surface is out of ARC-04's
// ui scope.
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
