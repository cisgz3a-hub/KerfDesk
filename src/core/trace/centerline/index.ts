export { traceCenterlineStrokePaths, inkMaskFromPrepared } from './trace-centerline';
export { squaredDistanceField, radiusAt, type InkMask } from './distance-field';
export { sharpenChainBends, type SharpenedChain } from './sharpen-bends';
export { smoothChainCurvature } from './chain-smoothing';
export { refineChainForOutput } from './curve-refine';
export { simplifyChain, smoothRawChain } from './stroke-chains';
export { thinToMedialAxis } from './medial-thinning';
export { buildStrokeGraph, type StrokeGraph, type StrokeChain } from './stroke-graph';
export { condenseJunctions } from './junction-condense';
export { pruneSpurs, DEFAULT_SPUR_OPTIONS } from './spur-pruning';
export { assembleStrokePaths } from './stroke-chains';
export {
  closePolylineLoops,
  closeRingEndpoints,
  LOOP_TOUCH_GAP_PX,
  type LoopClosureOptions,
} from './loop-closure';
export { SegmentGrid, type GridSegment } from './spatial-grid';
