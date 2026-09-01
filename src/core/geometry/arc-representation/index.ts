// Narrow public surface for circular-arc geometry used across core modules.
// The legacy geometry barrel is at its export cap, so consumers use this
// index-only entry point instead of deep-importing circular-arc.ts.
export {
  CIRCULAR_ARC_RADIUS_TOLERANCE_MM,
  circularArcGeometry,
  circularArcLengthMm,
  isCircularArcFullCircle,
  sampleCircularArcPoints,
  type CircularArc2d,
  type CircularArcGeometry,
} from '../circular-arc';
