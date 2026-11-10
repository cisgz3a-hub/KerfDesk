// core/design/dimensions — dimensions that drive their geometry (ADR-272
// Amendment 7, Phase N DS-7). Its own sub-barrel, like snap/ops/entry: the
// parent core/design barrel is at the ADR-015 cap.

export {
  driveDimension,
  enforceDimensions,
  lineAngle,
  measureDimension,
  setDimensionDriving,
} from './dimension-solve';
export { inferDimension, type DimensionInference, type DimensionPick } from './infer-dimension';
export {
  DIMENSION_KINDS,
  isAngular,
  isWellFormedDimension,
  sanitizeDimensions,
  sketchDimensions,
  withDimensions,
  type DimensionKind,
  type SketchDimension,
} from './sketch-dimension';
